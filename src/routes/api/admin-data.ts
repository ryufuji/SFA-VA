import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requireAdmin } from '../../middleware/auth'
import { logAction } from '../../auth'
import { EXPORT_TABLES } from '../../lib/constants'
import { exportTableToCsv } from '../../lib/helpers'
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
    
    // タイムスタンプを生成（日本時間）
    const timestamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo', hour12: false }).replace(/[- ]/g, m => m === ' ' ? '_' : '').replace(/:/g, '')
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
    
    const timestamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo', hour12: false }).replace(/[- ]/g, m => m === ' ' ? '_' : '').replace(/:/g, '')
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
    
    const results: any[] = []
    
    console.log('Starting import process. Mode:', mode, 'Tables:', metadata.tables.length)

    // CSV全体をパースして行（レコード）の配列を返す関数
    // 改行を含むクォートフィールドにも対応
    const parseCsvRecords = (csv: string): string[][] => {
      const records: string[][] = []
      let i = 0
      const len = csv.length
      
      while (i < len) {
        const record: string[] = []
        // 1レコードを読み取る
        while (i < len) {
          let value = ''
          if (csv[i] === '"') {
            // クォートフィールド: 次の閉じクォートまで（""はエスケープ）
            i++ // 開始クォートをスキップ
            while (i < len) {
              if (csv[i] === '"') {
                if (i + 1 < len && csv[i + 1] === '"') {
                  value += '"'
                  i += 2
                } else {
                  i++ // 閉じクォートをスキップ
                  break
                }
              } else {
                value += csv[i]
                i++
              }
            }
            // クォート後のカンマ or 改行をスキップ
            if (i < len && csv[i] === ',') {
              i++
              record.push(value)
              continue
            }
          } else {
            // 非クォートフィールド: カンマ or 改行まで
            while (i < len && csv[i] !== ',' && csv[i] !== '\n' && csv[i] !== '\r') {
              value += csv[i]
              i++
            }
            if (i < len && csv[i] === ',') {
              i++
              record.push(value.trim())
              continue
            }
          }
          record.push(value.trim())
          break
        }
        // 改行をスキップ
        while (i < len && (csv[i] === '\r' || csv[i] === '\n')) i++
        // 空レコードをスキップ
        if (record.length === 1 && record[0] === '') continue
        records.push(record)
      }
      return records
    }

    // 値の整形関数（parseCsvRecordsがクォート処理済みなので簡素化）
    const cleanValue = (v: string): string | null => {
      if (v === '') return null
      return v
    }

    // バッチを分割して実行するヘルパー（D1のバッチサイズ制限対策）
    const BATCH_SIZE = 80 // D1の安全なバッチサイズ
    const executeBatchInChunks = async (queries: any[]) => {
      for (let i = 0; i < queries.length; i += BATCH_SIZE) {
        const chunk = queries.slice(i, i + BATCH_SIZE)
        console.log(`Executing batch chunk ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(queries.length / BATCH_SIZE)} (${chunk.length} queries)`)
        await DB.batch(chunk)
      }
    }
    
    // Replaceモード: 外部キー制約を無効化→全テーブルDELETE→データINSERT→外部キー再有効化
    if (mode === 'replace') {
      console.log('Replace mode: disabling foreign keys, deleting all data, then re-inserting')
      
      // 1. 外部キー制約を無効化してから全テーブルを削除
      //    EXPORT_TABLESの逆順（依存先→依存元）でDELETEし、漏れを防ぐ
      const deleteQueries: any[] = []
      // EXPORT_TABLESの全テーブルを逆順で削除（metadata.tablesは部分集合の可能性があるため）
      const importTableNames = new Set(metadata.tables.map((t: any) => t.name))
      const allTableNamesReversed = [...EXPORT_TABLES].reverse()
      
      // 外部キーを無効化
      deleteQueries.push(DB.prepare('PRAGMA foreign_keys = OFF'))
      
      for (const table of allTableNamesReversed) {
        if (importTableNames.has(table.name)) {
          deleteQueries.push(DB.prepare(`DELETE FROM ${table.name}`))
          // AUTOINCREMENTシーケンスもリセット
          deleteQueries.push(DB.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).bind(table.name))
          console.log(`Added DELETE for table: ${table.name}`)
        }
      }
      
      // DELETE実行
      try {
        await executeBatchInChunks(deleteQueries)
        console.log('All DELETE operations completed successfully')
      } catch (deleteError: any) {
        // 外部キーを再有効化してからエラー返却
        try { await DB.prepare('PRAGMA foreign_keys = ON').run() } catch (_) {}
        console.error('DELETE failed:', deleteError)
        return c.json({
          success: false,
          error: 'データ削除に失敗しました: ' + deleteError.message,
          details: { phase: 'delete', message: deleteError.message }
        }, 500)
      }
      
      // 2. データINSERT（EXPORT_TABLESの正順 = 依存元→依存先）
      //    metadata.tablesの順序はEXPORT_TABLESと同じはずだが念のためEXPORT_TABLES順で処理
      const orderedTables = EXPORT_TABLES
        .filter(et => importTableNames.has(et.name))
        .map(et => {
          const meta = metadata.tables.find((t: any) => t.name === et.name)
          return meta ? { ...meta, label: meta.label || et.label } : null
        })
        .filter(Boolean) as any[]
      
      for (const table of orderedTables) {
        const csvData = findFile(table.file)
        if (!csvData) {
          console.log(`CSV file not found for table: ${table.name}`)
          continue
        }
        
        const csv = strFromU8(csvData)
        const records = parseCsvRecords(csv)
        if (records.length < 2) {
          console.log(`No data rows for table: ${table.name}`)
          results.push({ table: table.name, label: table.label, inserted: 0, updated: 0, errors: 0 })
          continue
        }
        
        console.log(`Processing table: ${table.name}, rows: ${records.length - 1}`)
        let inserted = 0
        let errors = 0
        
        try {
          let headers = records[0].map((h: string) => h.trim())
          
          // usersテーブル: password_hashがエクスポート時に除外されているので追加
          const isUsersTable = table.name === 'users'
          const hasPasswordHash = headers.includes('password_hash')
          if (isUsersTable && !hasPasswordHash) {
            headers.push('password_hash')
          }
          
          const insertQueries: any[] = []
          
          for (let i = 1; i < records.length; i++) {
            const cleanValues = records[i].map(cleanValue)
            
            // usersテーブルのpassword_hash補完
            if (isUsersTable && !hasPasswordHash) {
              cleanValues.push('ByeRnkKlpwWUMXXua5KZBkoC8Nhw8y/St0JD9lYz9a2rdXErR826spcfm6Rn1ZD/')
            }
            if (isUsersTable && hasPasswordHash) {
              const pwIdx = headers.indexOf('password_hash')
              if (pwIdx !== -1 && (!cleanValues[pwIdx] || cleanValues[pwIdx] === '')) {
                cleanValues[pwIdx] = 'ByeRnkKlpwWUMXXua5KZBkoC8Nhw8y/St0JD9lYz9a2rdXErR826spcfm6Rn1ZD/'
              }
            }
            
            // ヘッダー数と値の数の不一致チェック
            if (cleanValues.length !== headers.length) {
              console.warn(`Table ${table.name} row ${i}: header count ${headers.length} != value count ${cleanValues.length}, skipping`)
              errors++
              continue
            }
            
            const placeholders = headers.map(() => '?').join(', ')
            const sql = `INSERT INTO ${table.name} (${headers.join(', ')}) VALUES (${placeholders})`
            insertQueries.push(DB.prepare(sql).bind(...cleanValues))
            inserted++
          }
          
          // テーブルごとにバッチ実行
          if (insertQueries.length > 0) {
            await executeBatchInChunks(insertQueries)
            console.log(`Table ${table.name}: inserted ${inserted} rows`)
          }
          
          results.push({ table: table.name, label: table.label, inserted, updated: 0, errors })
          
        } catch (insertError: any) {
          console.error(`INSERT error for table ${table.name}:`, insertError)
          results.push({
            table: table.name,
            label: table.label,
            inserted: 0,
            updated: 0,
            errors: 1,
            error: insertError.message
          })
        }
      }
      
      // 3. 外部キー制約を再有効化
      try {
        await DB.prepare('PRAGMA foreign_keys = ON').run()
        console.log('Foreign keys re-enabled')
      } catch (fkError: any) {
        console.warn('Failed to re-enable foreign keys:', fkError.message)
      }
      
    } else {
      // Append/Mergeモード: テーブルごとに処理
      for (const table of metadata.tables) {
        const csvData = findFile(table.file)
        if (!csvData) {
          console.log(`CSV file not found for table: ${table.name}`)
          continue
        }
        
        const csv = strFromU8(csvData)
        const records = parseCsvRecords(csv)
        if (records.length < 2) {
          console.log(`No data rows for table: ${table.name}`)
          continue
        }
        
        console.log(`Processing table: ${table.name}, rows: ${records.length - 1}`)
        let inserted = 0
        let updated = 0
        let errors = 0
        
        try {
          let headers = records[0].map((h: string) => h.trim())
          
          const isUsersTable = table.name === 'users'
          const hasPasswordHash = headers.includes('password_hash')
          if (isUsersTable && !hasPasswordHash) {
            headers.push('password_hash')
          }
          
          const insertQueries: any[] = []
          
          for (let i = 1; i < records.length; i++) {
            const cleanValues = records[i].map(cleanValue)
            
            if (isUsersTable && !hasPasswordHash) {
              cleanValues.push('ByeRnkKlpwWUMXXua5KZBkoC8Nhw8y/St0JD9lYz9a2rdXErR826spcfm6Rn1ZD/')
            }
            if (isUsersTable && hasPasswordHash) {
              const pwIdx = headers.indexOf('password_hash')
              if (pwIdx !== -1 && (!cleanValues[pwIdx] || cleanValues[pwIdx] === '')) {
                cleanValues[pwIdx] = 'ByeRnkKlpwWUMXXua5KZBkoC8Nhw8y/St0JD9lYz9a2rdXErR826spcfm6Rn1ZD/'
              }
            }
            
            // ヘッダー数と値の数の不一致チェック
            if (cleanValues.length !== headers.length) {
              console.warn(`Table ${table.name} row ${i}: header count ${headers.length} != value count ${cleanValues.length}, skipping`)
              errors++
              continue
            }
            
            if (mode === 'merge') {
              const placeholders = headers.map(() => '?').join(', ')
              const updateSet = headers
                .filter(h => h !== 'id')
                .map(h => `${h} = excluded.${h}`)
                .join(', ')
              const sql = `INSERT INTO ${table.name} (${headers.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`
              insertQueries.push(DB.prepare(sql).bind(...cleanValues))
              updated++
            } else {
              // Appendモード: IDを除外して新規INSERT
              let insertHeaders = headers
              let insertValues = cleanValues
              if (headers.includes('id')) {
                const idIndex = headers.indexOf('id')
                insertHeaders = headers.filter((_: any, idx: number) => idx !== idIndex)
                insertValues = cleanValues.filter((_: any, idx: number) => idx !== idIndex)
              }
              const placeholders = insertHeaders.map(() => '?').join(', ')
              const sql = `INSERT INTO ${table.name} (${insertHeaders.join(', ')}) VALUES (${placeholders})`
              insertQueries.push(DB.prepare(sql).bind(...insertValues))
              inserted++
            }
          }
          
          // テーブルごとにバッチ実行
          if (insertQueries.length > 0) {
            await executeBatchInChunks(insertQueries)
            console.log(`Table ${table.name}: ${mode === 'merge' ? 'merged' : 'inserted'} ${inserted + updated} rows`)
          }
          
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
    
    // CSV全体をパース（改行含むクォートフィールド対応）
    const parseCsvRecords = (csv: string): string[][] => {
      const records: string[][] = []
      let i = 0
      const len = csv.length
      while (i < len) {
        const record: string[] = []
        while (i < len) {
          let value = ''
          if (csv[i] === '"') {
            i++
            while (i < len) {
              if (csv[i] === '"') {
                if (i + 1 < len && csv[i + 1] === '"') { value += '"'; i += 2 }
                else { i++; break }
              } else { value += csv[i]; i++ }
            }
            if (i < len && csv[i] === ',') { i++; record.push(value); continue }
          } else {
            while (i < len && csv[i] !== ',' && csv[i] !== '\n' && csv[i] !== '\r') { value += csv[i]; i++ }
            if (i < len && csv[i] === ',') { i++; record.push(value.trim()); continue }
          }
          record.push(value.trim())
          break
        }
        while (i < len && (csv[i] === '\r' || csv[i] === '\n')) i++
        if (record.length === 1 && record[0] === '') continue
        records.push(record)
      }
      return records
    }
    const cleanVal = (v: string): string | null => v === '' ? null : v
    
    const records = parseCsvRecords(csvText)
    
    if (records.length < 2) {
      return c.json({ error: 'CSVファイルにデータがありません' }, 400)
    }
    
    console.log(`CSV Import - Table: ${tableName}, Mode: ${mode}, Rows: ${records.length - 1}`)
    
    let inserted = 0
    let updated = 0
    let errors = 0

    const BATCH_SIZE = 80
    const executeBatchInChunks = async (queries: any[]) => {
      for (let i = 0; i < queries.length; i += BATCH_SIZE) {
        const chunk = queries.slice(i, i + BATCH_SIZE)
        await DB.batch(chunk)
      }
    }
    
    try {
      // ヘッダー行からカラム名を取得
      let headers = records[0].map((h: string) => h.trim())
      console.log(`Table ${tableName} headers:`, headers)
      
      // usersテーブルの特別処理
      const isUsersTable = tableName === 'users'
      const hasPasswordHash = headers.includes('password_hash')
      if (isUsersTable && !hasPasswordHash) {
        headers.push('password_hash')
      }
      
      // Replaceモード: 外部キーを無効化してDELETE
      if (mode === 'replace') {
        console.log(`Replace mode: disabling FK, deleting table ${tableName}`)
        await DB.batch([
          DB.prepare('PRAGMA foreign_keys = OFF'),
          DB.prepare(`DELETE FROM ${tableName}`),
          DB.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).bind(tableName)
        ])
      }
      
      const insertQueries: any[] = []
      
      for (let i = 1; i < records.length; i++) {
        const cleanValues = records[i].map(cleanVal)
        
        if (isUsersTable && !hasPasswordHash) {
          cleanValues.push('ByeRnkKlpwWUMXXua5KZBkoC8Nhw8y/St0JD9lYz9a2rdXErR826spcfm6Rn1ZD/')
        }
        if (isUsersTable && hasPasswordHash) {
          const pwIdx = headers.indexOf('password_hash')
          if (pwIdx !== -1 && (!cleanValues[pwIdx] || cleanValues[pwIdx] === '')) {
            cleanValues[pwIdx] = 'ByeRnkKlpwWUMXXua5KZBkoC8Nhw8y/St0JD9lYz9a2rdXErR826spcfm6Rn1ZD/'
          }
        }
        
        // ヘッダー数と値の数の不一致チェック
        if (cleanValues.length !== headers.length) {
          console.warn(`Table ${tableName} row ${i}: header count ${headers.length} != value count ${cleanValues.length}, skipping`)
          errors++
          continue
        }
        
        if (mode === 'merge') {
          const placeholders = headers.map(() => '?').join(', ')
          const updateSet = headers
            .filter(h => h !== 'id')
            .map(h => `${h} = excluded.${h}`)
            .join(', ')
          const sql = `INSERT INTO ${tableName} (${headers.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`
          insertQueries.push(DB.prepare(sql).bind(...cleanValues))
          updated++
        } else {
          // Replace/Appendモード
          let insertHeaders = headers
          let insertValues = cleanValues
          
          if (mode === 'append' && headers.includes('id')) {
            const idIndex = headers.indexOf('id')
            insertHeaders = headers.filter((_: any, idx: number) => idx !== idIndex)
            insertValues = cleanValues.filter((_: any, idx: number) => idx !== idIndex)
          }
          
          const placeholders = insertHeaders.map(() => '?').join(', ')
          const sql = `INSERT INTO ${tableName} (${insertHeaders.join(', ')}) VALUES (${placeholders})`
          insertQueries.push(DB.prepare(sql).bind(...insertValues))
          inserted++
        }
      }
      
      // バッチ実行
      if (insertQueries.length > 0) {
        await executeBatchInChunks(insertQueries)
        console.log(`CSV batch execution successful: ${inserted + updated} rows`)
      }
      
      // Replaceモード: 外部キーを再有効化
      if (mode === 'replace') {
        try { await DB.prepare('PRAGMA foreign_keys = ON').run() } catch (_) {}
      }
      
    } catch (error: any) {
      // 外部キーを再有効化
      if (mode === 'replace') {
        try { await DB.prepare('PRAGMA foreign_keys = ON').run() } catch (_) {}
      }
      console.error(`CSV Import error for table ${tableName}:`, error)
      
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
