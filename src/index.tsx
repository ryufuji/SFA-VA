import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database;
  STORAGE: R2Bucket;
}

// API Routes (分割済み)
import leadsApi from './routes/api/leads'
import projectsApi from './routes/api/projects'
import meetingNotesApi from './routes/api/meeting-notes'
import contractsApi from './routes/api/contracts'
import monthlyDetailsApi from './routes/api/monthly-details'
import paymentsApi from './routes/api/payments'
import bankDepositsApi from './routes/api/bank-deposits'
import authRoutesApi from './routes/api/auth-routes'
import adminUsersApi from './routes/api/admin-users'
import adminDataApi from './routes/api/admin-data'
import membersApi from './routes/api/members'
import monthlyMemberAssignmentsApi from './routes/api/monthly-member-assignments'
import dashboardApi from './routes/api/dashboard'
import companyInfoApi from './routes/api/company-info'
import quotesApi from './routes/api/quotes'
import invoicesApi from './routes/api/invoices'
import esignApi from './routes/api/esign'
import esignPublicApi from './routes/api/esign-public'

// Page Routes (分割済み)
import miscPages from './routes/pages/misc'
import authPages from './routes/pages/auth-pages'
import dashboardPages from './routes/pages/dashboard'
import leadsPages from './routes/pages/leads'
import projectsPages from './routes/pages/projects'
import contractsPages from './routes/pages/contracts'
import monthlyPages from './routes/pages/monthly'
import membersPages from './routes/pages/members'
import quotesPages from './routes/pages/quotes'
import invoicesPages from './routes/pages/invoices'
import bankDepositsPages from './routes/pages/bank-deposits'
import paymentsPages from './routes/pages/payments'
import detailsPages from './routes/pages/details'
import settingsPages from './routes/pages/settings'
import adminPages from './routes/pages/admin'
import signPages from './routes/pages/sign'
import esignPages from './routes/pages/esign'

const app = new Hono<{ Bindings: Bindings }>()

// CORS設定 (API用)
app.use('/api/*', cors())

// API ルート登録
app.route('/api/leads', leadsApi)
app.route('/api/projects', projectsApi)
app.route('/api/meeting-notes', meetingNotesApi)
app.route('/api/contracts', contractsApi)
app.route('/api/monthly-details', monthlyDetailsApi)
app.route('/api', paymentsApi)
app.route('/api/bank-deposits', bankDepositsApi)
app.route('/api/auth', authRoutesApi)
app.route('/api/admin', adminUsersApi)
app.route('/api/admin/data', adminDataApi)
app.route('/api/members', membersApi)
app.route('/api/monthly-member-assignments', monthlyMemberAssignmentsApi)
app.route('/api/dashboard', dashboardApi)
app.route('/api/company-info', companyInfoApi)
app.route('/api/quotes', quotesApi)
app.route('/api/invoices', invoicesApi)
app.route('/api/esign', esignApi)
app.route('/api/sign', esignPublicApi)

// Page ルート登録
app.route('/', miscPages)
app.route('/', authPages)
app.route('/', dashboardPages)
app.route('/', leadsPages)
app.route('/', projectsPages)
app.route('/', esignPages)
app.route('/', contractsPages)
app.route('/', monthlyPages)
app.route('/', membersPages)
app.route('/', quotesPages)
app.route('/', invoicesPages)
app.route('/', bankDepositsPages)
app.route('/', paymentsPages)
app.route('/', detailsPages)
app.route('/', settingsPages)
app.route('/', adminPages)
app.route('/', signPages)

export default app
