import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requireAdmin } from '../../middleware/auth'
import { logAction } from '../../auth'
import { EXPORT_TABLES } from '../../lib/constants'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'

const app = new Hono<AppEnv>()

app.get('/export/all', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  
  try {
    // メタデータ作成
    const metadata = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      exported_by: user.email || 'unknown',
      database_schema_version: '0024',
      tables: [] as any[],
      options: {
        include_users: true,
        include_system_settings: true,
        anonymize_data: false
      }
    }
    
    // ZIP用のファイル辞書を作成
    const zipFiles: { [key: string]: Uint8Array } = {}
    
    // 各テーブルをCSVに変換
    for (const table of EXPORT_TABLES) {
      const csv = await exportTableToCsv(DB, table.name)
      if (csv) {
        // CSVをUint8Arrayに変換
        zipFiles[`${table.name}.csv`] = strToU8(csv)
        
        // 行数をカウント
        const lines = csv.split('\n').filter(line => line.trim())
        const rowCount = Math.max(0, lines.length - 1) // ヘッダーを除く
        
        metadata.tables.push({
          name: table.name,
          label: table.label,
          row_count: rowCount,
          file: `${table.name}.csv`
        })
      }
    }
    
    // メタデータをJSON文字列に変換してZIPに追加
    zipFiles['metadata.json'] = strToU8(JSON.stringify(metadata, null, 2))
    
    // ZIPファイルを生成
    const zippedData = zipSync(zipFiles, { level: 6 })
    
    // タイムスタンプを生成
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `backup_all_${timestamp}.zip`
    
    // ログ記録
    await logAction(
      DB,
      user.userId,
      'data_export',
      'backup',
      null,
      `Exported all tables (${metadata.tables.length} tables)`,
      null
    )
    
    // ZIPファイルをレスポンスとして返す
    return new Response(zippedData, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': zippedData.length.toString()
      }
    })
    
  } catch (error: any) {
    console.error('Export error:', error)
    return c.json({ 
      success: false, 
      error: 'エクスポートに失敗しました: ' + error.message 
    }, 500)
  }
})

app.post('/export/selective', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  const { tables, anonymize_data } = await c.req.json()
  
  if (!tables || !Array.isArray(tables) || tables.length === 0) {
    return c.json({ error: 'テーブルを選択してください' }, 400)
  }
  
  try {
    // 選択されたテーブルのみエクスポート
    const selectedTables = EXPORT_TABLES.filter(t => tables.includes(t.name))
    
    const metadata = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      exported_by: user.email || 'unknown',
      database_schema_version: '0024',
      tables: [] as any[],
      options: {
        include_users: tables.includes('users'),
        include_system_settings: tables.includes('system_settings'),
        anonymize_data: anonymize_data || false
      }
    }
    
    // ZIP用のファイル辞書を作成
    const zipFiles: { [key: string]: Uint8Array } = {}
    
    for (const table of selectedTables) {
      const csv = await exportTableToCsv(DB, table.name)
      if (csv) {
        // CSVをUint8Arrayに変換
        zipFiles[`${table.name}.csv`] = strToU8(csv)
        
        const lines = csv.split('\n').filter(line => line.trim())
        const rowCount = Math.max(0, lines.length - 1)
        
        metadata.tables.push({
          name: table.name,
          label: table.label,
          row_count: rowCount,
          file: `${table.name}.csv`
        })
      }
    }
    
    // メタデータをJSON文字列に変換してZIPに追加
    zipFiles['metadata.json'] = strToU8(JSON.stringify(metadata, null, 2))
    
    // ZIPファイルを生成
    const zippedData = zipSync(zipFiles, { level: 6 })
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `backup_selective_${timestamp}.zip`
    
    // ログ記録
    await logAction(
      DB,
      user.userId,
      'data_export',
      'backup',
      null,
      `Exported ${selectedTables.length} selected tables`,
      null
    )
    
    // ZIPファイルをレスポンスとして返す
    return new Response(zippedData, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': zippedData.length.toString()
      }
    })
    
  } catch (error: any) {
    console.error('Export error:', error)
    return c.json({ 
      success: false, 
      error: 'エクスポートに失敗しました: ' + error.message 
    }, 500)
  }
})

app.post('/import/preview', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  
  try {
    // multipart/form-dataからファイルを取得
    const formData = await c.req.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return c.json({ error: 'ファイルが選択されていません' }, 400)
    }
    
    console.log('File received:', file.name, 'Size:', file.size, 'Type:', file.type)
    
    // ファイルをArrayBufferとして読み込み
    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    
    console.log('ArrayBuffer size:', arrayBuffer.byteLength)
    
    // ZIPファイルを解凍
    let unzipped: any
    try {
      unzipped = unzipSync(uint8Array)
      console.log('Unzipped files:', Object.keys(unzipped))
    } catch (error: any) {
      console.error('Unzip error:', error)
      return c.json({ error: 'ZIPファイルの解凍に失敗しました: ' + error.message }, 400)
    }
    
    // ファイルパスを正規化する関数（ディレクトリ構造を無視）
    const findFile = (filename: string): Uint8Array | undefined => {
      // 直接ルートにある場合
      if (unzipped[filename]) return unzipped[filename]
      
      // ディレクトリ内を検索（__MACOSX を除外）
      for (const path of Object.keys(unzipped)) {
        if (path.includes('__MACOSX')) continue
        if (path.endsWith('/' + filename) || path.endsWith('\\' + filename)) {
          return unzipped[path]
        }
      }
      return undefined
    }
    
    // metadata.jsonを読み込み
    const metadataData = findFile('metadata.json')
    if (!metadataData) {
      console.error('metadata.json not found. Available files:', Object.keys(unzipped))
      return c.json({ 
        error: 'metadata.jsonが見つかりません。ZIPファイルに含まれるファイル: ' + Object.keys(unzipped).join(', ') 
      }, 400)
    }
    
    const metadataStr = strFromU8(metadataData)
    const metadata = JSON.parse(metadataStr)
    
    // バックアップファイルの検証
    const tablesFound = []
    const warnings = []
    
    for (const table of metadata.tables) {
      const csvData = findFile(table.file)
      if (csvData) {
        const csv = strFromU8(csvData)
        const lines = csv.split('\n').filter((line: string) => line.trim())
        const dataRows = Math.max(0, lines.length - 1)
        
        // 既存データの件数を確認
        try {
          const { results } = await DB.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).all()
          const existingRows = results && results[0] ? (results[0] as any).count : 0
          
          tablesFound.push({
            name: table.name,
            label: table.label,
            row_count: dataRows,
            existing_rows: existingRows,
            will_import: true,
            has_data: existingRows > 0
          })
          
          if (existingRows > 0) {
            warnings.push(`${table.label}に既存データ${existingRows}件があります`)
          }
        } catch (error) {
          tablesFound.push({
            name: table.name,
            label: table.label,
            row_count: dataRows,
            existing_rows: 0,
            will_import: true,
            has_data: false,
            error: 'テーブルが存在しません'
          })
        }
      }
    }
    
    return c.json({
      success: true,
      metadata,
      tables_found: tablesFound,
      warnings: warnings.length > 0 ? warnings : ['既存データが削除される可能性があります']
    })
    
  } catch (error: any) {
    console.error('Preview error:', error)
    return c.json({ 
      success: false, 
      error: 'プレビューに失敗しました: ' + error.message 
    }, 500)
  }
})

app.post('/import/execute', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  
  try {
    // multipart/form-dataからファイルとモードを取得
    const formData = await c.req.formData()
    const file = formData.get('file') as File
    const mode = formData.get('mode') as string || 'append'
    
    if (!file) {
      return c.json({ error: 'ファイルが選択されていません' }, 400)
    }
    
    if (!['replace', 'append', 'merge'].includes(mode)) {
      return c.json({ error: '無効なインポートモードです' }, 400)
    }
    
    // ファイルをArrayBufferとして読み込み
    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    
    // ZIPファイルを解凍
    let unzipped: any
    try {
      unzipped = unzipSync(uint8Array)
    } catch (error) {
      return c.json({ error: 'ZIPファイルの解凍に失敗しました' }, 400)
    }
    
    // ファイルパスを正規化する関数（ディレクトリ構造を無視）
    const findFile = (filename: string): Uint8Array | undefined => {
      // 直接ルートにある場合
      if (unzipped[filename]) return unzipped[filename]
      
      // ディレクトリ内を検索（__MACOSX を除外）
      for (const path of Object.keys(unzipped)) {
        if (path.includes('__MACOSX')) continue
        if (path.endsWith('/' + filename) || path.endsWith('\\' + filename)) {
          return unzipped[path]
        }
      }
      return undefined
    }
    
    // metadata.jsonを読み込み
    const metadataData = findFile('metadata.json')
    if (!metadataData) {
      return c.json({ error: 'metadata.jsonが見つかりません' }, 400)
    }
    
    const metadataStr = strFromU8(metadataData)
    const metadata = JSON.parse(metadataStr)
    
    const results = []
    const deleteQueries = []  // DELETE用（逆順で実行）
    const insertQueries = []  // INSERT用（正順で実行）
    const queryInfo = [] // デバッグ用：各クエリの情報を記録
    
    console.log('Starting import process. Mode:', mode, 'Tables:', metadata.tables.length)
    
    // Replaceモード: 既存データを削除（外部キー依存の逆順）
    if (mode === 'replace') {
      console.log('Replace mode: preparing DELETE queries in reverse order')
      const reversedTables = [...metadata.tables].reverse()
      for (const table of reversedTables) {
        const deleteQuery = DB.prepare(`DELETE FROM ${table.name}`)
        deleteQueries.push(deleteQuery)
        queryInfo.push({ type: 'DELETE', sql: `DELETE FROM ${table.name}`, table: table.name })
        console.log(`Added DELETE query for table: ${table.name}`)
      }
    }
    
    // データインポート（外部キー依存順）
    for (const table of metadata.tables) {
      const csvData = findFile(table.file)
      if (!csvData) {
        console.log(`CSV file not found for table: ${table.name}`)
        continue
      }
      
      const csv = strFromU8(csvData)
      const lines = csv.split('\n').filter((line: string) => line.trim())
      if (lines.length < 2) {
        console.log(`No data rows for table: ${table.name}`)
        continue
      }
      
      console.log(`Processing table: ${table.name}, rows: ${lines.length - 1}`)
      
      let inserted = 0
      let updated = 0
      let errors = 0
      
      try {
        // ヘッダー行からカラム名を取得
        let headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
        console.log(`Table ${table.name} headers:`, headers)
        
        // usersテーブルの特別処理: password_hashが欠けている場合はデフォルト値を追加
        const isUsersTable = table.name === 'users'
        const hasPasswordHash = headers.includes('password_hash')
        if (isUsersTable && !hasPasswordHash) {
          headers.push('password_hash')
          console.log(`Added password_hash column for users table`)
        }
        
        // データ行をインポート
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i]
          const values = []
          let current = ''
          let inQuotes = false
          
          // CSVパース（クォート対応）
          for (let j = 0; j < line.length; j++) {
            const char = line[j]
            if (char === '"') {
              inQuotes = !inQuotes
            } else if (char === ',' && !inQuotes) {
              values.push(current.trim())
              current = ''
            } else {
              current += char
            }
          }
          values.push(current.trim())
          
          // 値の整形（クォート除去、空文字列をnullに変換）
          const cleanValues = values.map(v => {
            if (v === '') return null
            if (v.startsWith('"') && v.endsWith('"')) {
              return v.slice(1, -1).replace(/""/g, '"')
            }
            return v
          })
          
          // usersテーブルでpassword_hashが欠けている場合、デフォルトのハッシュ値を追加
          if (isUsersTable && !hasPasswordHash) {
            // デフォルトパスワード 'admin123' のPBKDF2ハッシュ
            cleanValues.push('ByeRnkKlpwWUMXXua5KZBkoC8Nhw8y/St0JD9lYz9a2rdXErR826spcfm6Rn1ZD/')
          }
          
          // usersテーブルでpassword_hashがNULLまたは空の場合、デフォルト値に置き換える
          if (isUsersTable && hasPasswordHash) {
            const passwordHashIndex = headers.indexOf('password_hash')
            if (passwordHashIndex !== -1 && (!cleanValues[passwordHashIndex] || cleanValues[passwordHashIndex] === '')) {
              cleanValues[passwordHashIndex] = 'ByeRnkKlpwWUMXXua5KZBkoC8Nhw8y/St0JD9lYz9a2rdXErR826spcfm6Rn1ZD/'
              console.log(`Replaced empty password_hash with default for row ${i}`)
            }
          }
          
          if (mode === 'merge') {
            // Mergeモード: UPSERT（ON CONFLICT）
            const placeholders = headers.map(() => '?').join(', ')
            const updateSet = headers
              .filter(h => h !== 'id')
              .map(h => `${h} = excluded.${h}`)
              .join(', ')
            
            const sql = `INSERT INTO ${table.name} (${headers.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`
            insertQueries.push(DB.prepare(sql).bind(...cleanValues))
            queryInfo.push({ 
              type: 'MERGE', 
              sql, 
              table: table.name, 
              row: i, 
              values: cleanValues.slice(0, 3) // 最初の3つの値のみ記録
            })
            updated++
          } else {
            // Replace/Appendモード: INSERT
            // IDカラムがある場合、appendモードではIDを除外
            let insertHeaders = headers
            let insertValues = cleanValues
            
            if (mode === 'append' && headers.includes('id')) {
              const idIndex = headers.indexOf('id')
              insertHeaders = headers.filter((_, idx) => idx !== idIndex)
              insertValues = cleanValues.filter((_, idx) => idx !== idIndex)
            }
            
            const placeholders = insertHeaders.map(() => '?').join(', ')
            const sql = `INSERT INTO ${table.name} (${insertHeaders.join(', ')}) VALUES (${placeholders})`
            insertQueries.push(DB.prepare(sql).bind(...insertValues))
            queryInfo.push({ 
              type: 'INSERT', 
              sql, 
              table: table.name, 
              row: i, 
              values: insertValues.slice(0, 3) // 最初の3つの値のみ記録
            })
            inserted++
          }
        }
        
        console.log(`Table ${table.name}: prepared ${inserted + updated} queries`)
        
        results.push({
          table: table.name,
          label: table.label,
          inserted,
          updated: mode === 'merge' ? updated : 0,
          errors
        })
        
      } catch (error: any) {
        console.error(`Import error for table ${table.name}:`, error)
        results.push({
          table: table.name,
          label: table.label,
          inserted: 0,
          updated: 0,
          errors: 1,
          error: error.message
        })
      }
    }
    
    console.log(`Total DELETE queries: ${deleteQueries.length}`)
    console.log(`Total INSERT queries: ${insertQueries.length}`)
    console.log(`Query info summary:`, queryInfo.slice(0, 10)) // 最初の10件のみログ出力
    
    // バッチ実行: DELETEとINSERTを1つのバッチにまとめる
    // これにより、バッチ全体が成功または失敗するため、データ消失を防ぐ
    try {
      const allQueries = []
      
      if (mode === 'replace' && deleteQueries.length > 0) {
        // Replaceモード: DELETEを先に追加（逆順）
        console.log('Replace mode: Adding DELETE queries to batch (reverse order)')
        allQueries.push(...deleteQueries)
      }
      
      // INSERTを追加（正順）
      if (insertQueries.length > 0) {
        console.log('Adding INSERT queries to batch (forward order)')
        allQueries.push(...insertQueries)
      }
      
      // 1つのバッチとして実行
      if (allQueries.length > 0) {
        console.log(`Executing batch with ${allQueries.length} queries...`)
        await DB.batch(allQueries)
        console.log('Batch execution successful')
      }
    } catch (batchError: any) {
      console.error('Batch execution failed:', batchError)
      console.error('Error details:', {
        message: batchError.message,
        cause: batchError.cause,
        stack: batchError.stack
      })
      
      // より詳細なエラー情報を返す
      return c.json({ 
        success: false, 
        error: 'バッチ実行に失敗しました',
        details: {
          message: batchError.message,
          deleteQueries: deleteQueries.length,
          insertQueries: insertQueries.length,
          mode: mode,
          tables: metadata.tables.map((t: any) => t.name),
          queryInfoSample: queryInfo.slice(0, 20) // 最初の20クエリの情報
        }
      }, 500)
    }
    
    // ログ記録
    await logAction(
      DB,
      user.userId,
      'data_import',
      'backup',
      null,
      `Imported ${results.length} tables in ${mode} mode`,
      null
    )
    
    return c.json({
      success: true,
      mode,
      results
    })
    
  } catch (error: any) {
    console.error('Import error:', error)
    console.error('Error stack:', error.stack)
    return c.json({ 
      success: false, 
      error: 'インポートに失敗しました: ' + error.message,
      details: {
        stack: error.stack,
        cause: error.cause
      }
    }, 500)
  }
})

app.post('/import/csv', authMiddleware, requireAdmin, async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  
  try {
    // multipart/form-dataからファイル、テーブル名、モードを取得
    const formData = await c.req.formData()
    const file = formData.get('file') as File
    const tableName = formData.get('table_name') as string
    const mode = formData.get('mode') as string || 'append'
    
    if (!file) {
      return c.json({ error: 'CSVファイルが選択されていません' }, 400)
    }
    
    if (!tableName) {
      return c.json({ error: 'テーブル名が指定されていません' }, 400)
    }
    
    if (!['replace', 'append', 'merge'].includes(mode)) {
      return c.json({ error: '無効なインポートモードです' }, 400)
    }
    
    // テーブルが存在するか確認
    const tableConfig = EXPORT_TABLES.find(t => t.name === tableName)
    if (!tableConfig) {
      return c.json({ error: '指定されたテーブルが見つかりません' }, 400)
    }
    
    // ファイルをテキストとして読み込み
    const csvText = await file.text()
    const lines = csvText.split('\n').filter((line: string) => line.trim())
    
    if (lines.length < 2) {
      return c.json({ error: 'CSVファイルにデータがありません' }, 400)
    }
    
    console.log(`CSV Import - Table: ${tableName}, Mode: ${mode}, Rows: ${lines.length - 1}`)
    
    let inserted = 0
    let updated = 0
    let errors = 0
    
    const deleteQueries = []
    const insertQueries = []
    
    try {
      // Replaceモード: テーブルのデータを削除
      if (mode === 'replace') {
        console.log(`Replace mode: preparing DELETE for table ${tableName}`)
        const deleteQuery = DB.prepare(`DELETE FROM ${tableName}`)
        deleteQueries.push(deleteQuery)
      }
      
      // ヘッダー行からカラム名を取得
      let headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
      console.log(`Table ${tableName} headers:`, headers)
      
      // usersテーブルの特別処理: password_hashが欠けている場合はデフォルト値を追加
      const isUsersTable = tableName === 'users'
      const hasPasswordHash = headers.includes('password_hash')
      if (isUsersTable && !hasPasswordHash) {
        headers.push('password_hash')
        console.log(`Added password_hash column for users table`)
      }
      
      // データ行をインポート
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]
        const values = []
        let current = ''
        let inQuotes = false
        
        // CSVパース（クォート対応）
        for (let j = 0; j < line.length; j++) {
          const char = line[j]
          if (char === '"') {
            inQuotes = !inQuotes
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim())
            current = ''
          } else {
            current += char
          }
        }
        values.push(current.trim())
        
        // 値の整形（クォート除去、空文字列をnullに変換）
        const cleanValues = values.map(v => {
          if (v === '') return null
          if (v.startsWith('"') && v.endsWith('"')) {
            return v.slice(1, -1).replace(/""/g, '"')
          }
          return v
        })
        
        // usersテーブルでpassword_hashが欠けている場合、デフォルトのハッシュ値を追加
        if (isUsersTable && !hasPasswordHash) {
          cleanValues.push('ByeRnkKlpwWUMXXua5KZBkoC8Nhw8y/St0JD9lYz9a2rdXErR826spcfm6Rn1ZD/')
        }
        
        // usersテーブルでpassword_hashがNULLまたは空の場合、デフォルト値に置き換える
        if (isUsersTable && hasPasswordHash) {
          const passwordHashIndex = headers.indexOf('password_hash')
          if (passwordHashIndex !== -1 && (!cleanValues[passwordHashIndex] || cleanValues[passwordHashIndex] === '')) {
            cleanValues[passwordHashIndex] = 'ByeRnkKlpwWUMXXua5KZBkoC8Nhw8y/St0JD9lYz9a2rdXErR826spcfm6Rn1ZD/'
            console.log(`Replaced empty password_hash with default for row ${i}`)
          }
        }
        
        if (mode === 'merge') {
          // Mergeモード: UPSERT（ON CONFLICT）
          const placeholders = headers.map(() => '?').join(', ')
          const updateSet = headers
            .filter(h => h !== 'id')
            .map(h => `${h} = excluded.${h}`)
            .join(', ')
          
          const sql = `INSERT INTO ${tableName} (${headers.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`
          insertQueries.push(DB.prepare(sql).bind(...cleanValues))
          updated++
        } else {
          // Replace/Appendモード: INSERT
          let insertHeaders = headers
          let insertValues = cleanValues
          
          if (mode === 'append' && headers.includes('id')) {
            const idIndex = headers.indexOf('id')
            insertHeaders = headers.filter((_, idx) => idx !== idIndex)
            insertValues = cleanValues.filter((_, idx) => idx !== idIndex)
          }
          
          const placeholders = insertHeaders.map(() => '?').join(', ')
          const sql = `INSERT INTO ${tableName} (${insertHeaders.join(', ')}) VALUES (${placeholders})`
          insertQueries.push(DB.prepare(sql).bind(...insertValues))
          inserted++
        }
      }
      
      console.log(`Prepared ${inserted + updated} queries for ${tableName}`)
      
      // バッチ実行: DELETEとINSERTを1つのバッチにまとめる
      const allQueries = []
      
      if (mode === 'replace' && deleteQueries.length > 0) {
        allQueries.push(...deleteQueries)
      }
      
      if (insertQueries.length > 0) {
        allQueries.push(...insertQueries)
      }
      
      if (allQueries.length > 0) {
        console.log(`Executing batch with ${allQueries.length} queries...`)
        await DB.batch(allQueries)
        console.log('Batch execution successful')
      }
      
    } catch (error: any) {
      console.error(`CSV Import error for table ${tableName}:`, error)
      errors = 1
      
      return c.json({ 
        success: false, 
        error: 'CSVインポートに失敗しました',
        details: {
          message: error.message,
          table: tableName,
          mode: mode
        }
      }, 500)
    }
    
    // ログ記録
    await logAction(
      DB,
      user.userId,
      'csv_import',
      'backup',
      null,
      `CSV imported to ${tableName} table in ${mode} mode`,
      null
    )
    
    return c.json({
      success: true,
      mode,
      result: {
        table: tableName,
        label: tableConfig.label,
        inserted,
        updated: mode === 'merge' ? updated : 0,
        errors
      }
    })
    
  } catch (error: any) {
    console.error('CSV Import error:', error)
    return c.json({ 
      success: false, 
      error: 'CSVインポートに失敗しました: ' + error.message,
      details: {
        message: error.message,
        stack: error.stack
      }
    }, 500)
  }
})

app.get('/tables', authMiddleware, requireAdmin, async (c) => {
  return c.json({
    success: true,
    tables: EXPORT_TABLES
  })
})


export default app
