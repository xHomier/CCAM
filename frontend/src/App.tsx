import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { NavShell } from "./components/NavShell";
import { Login } from "./pages/Login";
import { Live } from "./pages/Live";
import { Events } from "./pages/Events";
import { Recordings } from "./pages/Recordings";
import { Settings } from "./pages/Settings";
import { SettingsUsers } from "./pages/SettingsUsers";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<NavShell />}>
              <Route path="/" element={<Navigate to="/live" replace />} />
              <Route path="/live" element={<Live />} />
              <Route path="/events" element={<Events />} />
              <Route path="/recordings" element={<Recordings />} />

              <Route element={<ProtectedRoute role="admin" />}>
                <Route path="/settings" element={<Settings />} />
                <Route path="/settings/users" element={<SettingsUsers />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/live" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
