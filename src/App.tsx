import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { AppShell } from './components/AppShell'
import { SignIn } from './pages/SignIn'
import { Verify } from './pages/Verify'
import { ClientReports } from './pages/ClientReports'
import { NewReport } from './pages/NewReport'
import { ReportDetail } from './pages/ReportDetail'
import { AdminTracker } from './pages/AdminTracker'
import { AdminClients } from './pages/AdminClients'

function Routed() {
  const { user, loading } = useAuth()
  if (loading) return <p className="px-6 py-24 text-center text-slate-500">Loading…</p>
  if (!user) {
    return (
      <Routes>
        <Route path="/auth/verify" element={<Verify />} />
        <Route path="*" element={<SignIn />} />
      </Routes>
    )
  }
  const home = user.role === 'admin' ? '/admin' : '/reports'
  return (
    <Routes>
      <Route path="/auth/verify" element={<Navigate to={home} replace />} />
      <Route element={<AppShell />}>
        {user.role === 'admin' ? (
          <>
            <Route path="/admin" element={<AdminTracker />} />
            <Route path="/admin/clients" element={<AdminClients />} />
          </>
        ) : (
          <>
            <Route path="/reports" element={<ClientReports />} />
            <Route path="/reports/new" element={<NewReport />} />
            <Route path="/reports/:id" element={<ReportDetail />} />
          </>
        )}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routed />
      </AuthProvider>
    </BrowserRouter>
  )
}
