import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { ProjectProvider } from './lib/project'
import { rememberReturnPath } from './lib/returnTo'
import { AdminShell } from './components/AdminShell'
import { ClientShell } from './components/ClientShell'
import { Skeleton } from './components/ui'
import { SignIn } from './pages/SignIn'
import { Verify } from './pages/Verify'
import { ClientHome } from './pages/ClientHome'
import { NewReport } from './pages/NewReport'
import { ReportDetail } from './pages/ReportDetail'
import { AdminInbox } from './pages/AdminInbox'
import { AdminTracker } from './pages/AdminTracker'
import { AdminRoadmap } from './pages/AdminRoadmap'
import { AdminClients } from './pages/AdminClients'

/** Keeps the report drawer link from an email (/admin?report=ID) working. */
function AdminHome() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: search.includes('report=') ? '/admin/tracker' : '/admin/inbox', search }} replace />
}

function SignedOut() {
  const { pathname, search } = useLocation()
  // Remember where they were headed so sign-in can take them straight back.
  useEffect(() => { rememberReturnPath(pathname + search) }, [pathname, search])
  return (
    <Routes>
      <Route path="/auth/verify" element={<Verify />} />
      <Route path="*" element={<SignIn />} />
    </Routes>
  )
}

function Routed() {
  const { user, loading } = useAuth()
  if (loading) return <div className="mx-auto max-w-md px-4 py-24"><Skeleton rows={3} /></div>
  if (!user) return <SignedOut />

  if (user.role === 'admin') {
    return (
      <ProjectProvider>
        <Routes>
          <Route path="/auth/verify" element={<Navigate to="/admin/inbox" replace />} />
          <Route element={<AdminShell />}>
            <Route path="/admin" element={<AdminHome />} />
            <Route path="/admin/inbox" element={<AdminInbox />} />
            <Route path="/admin/tracker" element={<AdminTracker />} />
            <Route path="/admin/roadmap" element={<AdminRoadmap />} />
            <Route path="/admin/clients" element={<AdminClients />} />
            <Route path="*" element={<Navigate to="/admin/inbox" replace />} />
          </Route>
        </Routes>
      </ProjectProvider>
    )
  }
  return (
    <Routes>
      <Route path="/auth/verify" element={<Navigate to="/reports" replace />} />
      <Route element={<ClientShell />}>
        <Route path="/reports" element={<ClientHome />} />
        <Route path="/reports/new" element={<NewReport />} />
        <Route path="/reports/:id" element={<ReportDetail />} />
        <Route path="/roadmap" element={<Navigate to="/reports?view=board" replace />} />
        <Route path="*" element={<Navigate to="/reports" replace />} />
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
