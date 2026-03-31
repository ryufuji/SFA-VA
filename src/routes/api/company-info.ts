import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware } from '../../middleware/auth'
import { logAction } from '../../auth'

const app = new Hono<AppEnv>()

app.get('/', authMiddleware, async (c) => {
  const { DB } = c.env
  
  const companyInfo = await DB.prepare('SELECT * FROM company_info WHERE id = 1').first()
  
  if (!companyInfo) {
    return c.json({ success: false, error: '自社情報が見つかりません' }, 404)
  }
  
  return c.json({ success: true, data: companyInfo })
})

app.put('/', authMiddleware, async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  
  // 権限チェック
  const userRecord = await DB.prepare('SELECT can_edit_company_info FROM users WHERE id = ?')
    .bind(user.userId).first()
  
  if (!userRecord || !(userRecord as any).can_edit_company_info) {
    return c.json({ success: false, error: '自社情報を編集する権限がありません' }, 403)
  }
  
  const body = await c.req.json()
  const {
    company_name,
    postal_code,
    address,
    registration_number,
    bank_name,
    bank_branch,
    account_type,
    account_number,
    account_holder
  } = body
  
  if (!company_name) {
    return c.json({ success: false, error: '会社名は必須です' }, 400)
  }
  
  await DB.prepare(`
    UPDATE company_info 
    SET company_name = ?,
        postal_code = ?,
        address = ?,
        registration_number = ?,
        bank_name = ?,
        bank_branch = ?,
        account_type = ?,
        account_number = ?,
        account_holder = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).bind(
    company_name,
    postal_code || null,
    address || null,
    registration_number || null,
    bank_name || null,
    bank_branch || null,
    account_type || null,
    account_number || null,
    account_holder || null
  ).run()
  
  await logAction(
    DB,
    user.userId,
    'update_company_info',
    'company_info',
    1,
    body,
    c.req.header('CF-Connecting-IP') || null
  )
  
  return c.json({ success: true, message: '自社情報を更新しました' })
})

app.post('/upload-logo', authMiddleware, async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  
  // 権限チェック
  const userRecord = await DB.prepare('SELECT can_edit_company_info FROM users WHERE id = ?')
    .bind(user.userId).first()
  
  if (!userRecord || !(userRecord as any).can_edit_company_info) {
    return c.json({ success: false, error: '自社情報を編集する権限がありません' }, 403)
  }
  
  try {
    const formData = await c.req.formData()
    const file = formData.get('logo') as File
    
    if (!file) {
      return c.json({ success: false, error: 'ファイルが見つかりません' }, 400)
    }
    
    // ファイルサイズチェック（1MB）
    const maxSize = 1 * 1024 * 1024
    if (file.size > maxSize) {
      return c.json({ success: false, error: 'ファイルサイズが大きすぎます（最大1MB）' }, 400)
    }
    
    // ファイルをBase64に変換（大きなファイルでもスタックオーバーフローしないようチャンク処理）
    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    let binary = ''
    const chunkSize = 8192
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length))
      binary += String.fromCharCode.apply(null, Array.from(chunk))
    }
    const base64 = btoa(binary)
    const dataUrl = `data:${file.type};base64,${base64}`
    
    // DBを更新
    await DB.prepare(`
      UPDATE company_info 
      SET logo_base64 = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).bind(dataUrl).run()
    
    await logAction(
      DB,
      user.userId,
      'upload_logo',
      'company_info',
      1,
      { file_type: file.type },
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({ success: true, message: 'ロゴをアップロードしました' })
  } catch (error: any) {
    return c.json({ success: false, error: 'アップロードに失敗しました: ' + error.message }, 500)
  }
})

app.post('/upload-seal', authMiddleware, async (c) => {
  const { DB } = c.env
  const user = c.get('user')
  
  // 権限チェック
  const userRecord = await DB.prepare('SELECT can_edit_company_info FROM users WHERE id = ?')
    .bind(user.userId).first()
  
  if (!userRecord || !(userRecord as any).can_edit_company_info) {
    return c.json({ success: false, error: '自社情報を編集する権限がありません' }, 403)
  }
  
  try {
    const formData = await c.req.formData()
    const file = formData.get('seal') as File
    
    if (!file) {
      return c.json({ success: false, error: 'ファイルが見つかりません' }, 400)
    }
    
    // ファイルサイズチェック（1MB）
    const maxSize = 1 * 1024 * 1024
    if (file.size > maxSize) {
      return c.json({ success: false, error: 'ファイルサイズが大きすぎます（最大1MB）' }, 400)
    }
    
    // ファイルをBase64に変換（大きなファイルでもスタックオーバーフローしないようチャンク処理）
    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    let binary = ''
    const chunkSize = 8192
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length))
      binary += String.fromCharCode.apply(null, Array.from(chunk))
    }
    const base64 = btoa(binary)
    const dataUrl = `data:${file.type};base64,${base64}`
    
    // DBを更新
    await DB.prepare(`
      UPDATE company_info 
      SET seal_base64 = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).bind(dataUrl).run()
    
    await logAction(
      DB,
      user.userId,
      'upload_seal',
      'company_info',
      1,
      { file_type: file.type },
      c.req.header('CF-Connecting-IP') || null
    )
    
    return c.json({ success: true, message: '会社印をアップロードしました' })
  } catch (error: any) {
    return c.json({ success: false, error: 'アップロードに失敗しました: ' + error.message }, 500)
  }
})

app.get('/image/:type', authMiddleware, async (c) => {
  const { DB } = c.env
  const type = c.req.param('type') // 'logo' or 'seal'
  
  const companyInfo = await DB.prepare('SELECT * FROM company_info WHERE id = 1').first() as any
  
  if (!companyInfo) {
    return c.json({ success: false, error: '自社情報が見つかりません' }, 404)
  }
  
  const base64Data = type === 'logo' ? companyInfo.logo_base64 : companyInfo.seal_base64
  
  if (!base64Data) {
    return c.json({ success: false, error: '画像が登録されていません' }, 404)
  }
  
  try {
    // data:image/png;base64,... 形式から画像データを抽出
    const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/)
    if (!matches) {
      return c.json({ success: false, error: '画像データの形式が不正です' }, 400)
    }
    
    const contentType = matches[1]
    const base64 = matches[2]
    
    // Base64をバイナリに変換
    const binaryString = atob(base64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    
    return new Response(bytes, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000'
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: '画像の取得に失敗しました: ' + error.message }, 500)
  }
})


export default app
