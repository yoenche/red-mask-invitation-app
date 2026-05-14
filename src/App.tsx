import { Outlet } from 'react-router-dom';

export function App() {
  return (
    <main className="app-shell">
      <Outlet />
    </main>
  );
}
