import { useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { DataProvider, useData } from './data'
import Now from './pages/Now'
import Week from './pages/Week'
import Todo from './pages/Todo'
import Library from './pages/Library'
import Review from './pages/Review'
import StatusBar from './components/StatusBar'

const isMobile = () => window.matchMedia('(max-width: 720px)').matches

function Shell() {
  const { ready } = useData()
  const { signOut } = useAuth()
  return (
    <div className="shell">
      <nav className="nav">
        <strong className="brand">Timeblock</strong>
        <NavLink to="/now">Now</NavLink>
        <NavLink to="/week">Week</NavLink>
        <NavLink to="/todo">To-do</NavLink>
        <NavLink to="/review">Review</NavLink>
        <NavLink to="/library">Library</NavLink>
        <button className="link nav-out" onClick={() => signOut()}>
          Sign out
        </button>
      </nav>
      {ready && <StatusBar />}
      <main className="main">
        {!ready ? (
          <p className="muted">Loading…</p>
        ) : (
          <Routes>
            <Route path="/now" element={<Now />} />
            <Route path="/week" element={<Week />} />
            <Route path="/todo" element={<Todo />} />
            <Route path="/review" element={<Review />} />
            <Route path="/library" element={<Library />} />
            <Route path="*" element={<Navigate to={isMobile() ? '/now' : '/week'} replace />} />
          </Routes>
        )}
      </main>
    </div>
  )
}

function SignIn() {
  const { signInEmail, signUpEmail, signInGuest } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const run = (fn: () => Promise<void>) => async () => {
    setError('')
    try {
      await fn()
    } catch (e: any) {
      setError(String(e?.code ?? e?.message ?? e).replace('auth/', ''))
    }
  }

  return (
    <form
      className="signin"
      onSubmit={(e) => {
        e.preventDefault()
        run(() => signInEmail(email, password))()
      }}
    >
      <h1>Timeblock</h1>
      <p className="muted">Plan the week in 15-minute blocks.</p>
      <input type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input type="password" placeholder="Password (6+ characters)" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error && <p className="overdue small">{error}</p>}
      <button className="primary">Sign in</button>
      <button type="button" onClick={run(() => signUpEmail(email, password))}>
        Create account
      </button>
      <button type="button" className="link" onClick={run(signInGuest)}>
        Continue as guest (testing)
      </button>
    </form>
  )
}

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <p className="muted center">Loading…</p>
  if (!user) return <SignIn />
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  )
}
