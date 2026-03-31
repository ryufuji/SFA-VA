import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { authMiddleware, requirePermission } from '../../middleware/auth'

const app = new Hono<AppEnv>()

app.post('/', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const { project_id, meeting_date, note } = await c.req.json()
  
  // バリデーション
  if (!project_id || !meeting_date || !note) {
    return c.json({ error: '必須項目を入力してください' }, 400)
  }
  
  // 案件の存在確認
  const project = await DB.prepare('SELECT id FROM projects WHERE id = ?').bind(project_id).first()
  if (!project) {
    return c.json({ error: '案件が見つかりません' }, 404)
  }
  
  // 商談メモを作成
  await DB.prepare(`
    INSERT INTO meeting_notes (project_id, meeting_date, note, created_by)
    VALUES (?, ?, ?, ?)
  `).bind(project_id, meeting_date, note, '管理者').run()
  
  return c.json({ success: true, message: '商談メモを追加しました' })
})

app.put('/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const { meeting_date, note } = await c.req.json()
  
  // バリデーション
  if (!meeting_date || !note) {
    return c.json({ error: '必須項目を入力してください' }, 400)
  }
  
  // 商談メモの存在確認
  const meetingNote = await DB.prepare('SELECT id FROM meeting_notes WHERE id = ?').bind(id).first()
  if (!meetingNote) {
    return c.json({ error: '商談メモが見つかりません' }, 404)
  }
  
  // 商談メモを更新
  await DB.prepare(`
    UPDATE meeting_notes 
    SET meeting_date = ?, note = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(meeting_date, note, id).run()
  
  return c.json({ success: true, message: '商談メモを更新しました' })
})

app.delete('/:id', authMiddleware, requirePermission('lead_manage'), async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  // 商談メモの存在確認
  const meetingNote = await DB.prepare('SELECT id FROM meeting_notes WHERE id = ?').bind(id).first()
  if (!meetingNote) {
    return c.json({ error: '商談メモが見つかりません' }, 404)
  }
  
  // 商談メモを削除
  await DB.prepare('DELETE FROM meeting_notes WHERE id = ?').bind(id).run()
  
  return c.json({ success: true, message: '商談メモを削除しました' })
})


export default app
