import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { AuthPopup } from './components/AuthPopup';
import { SettingsPopup } from './components/SettingsPopup';
import Editor from './Editor';
import AdminPage from './pages/AdminPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={
            <>
              <Editor />
              <AuthPopup />
              <SettingsPopup />
            </>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
