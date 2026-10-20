import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PrefsProvider } from './lib/prefs.tsx';
import { Layout } from './components/Layout.tsx';
import { Home } from './pages/Home.tsx';
import { CreateComingSoon } from './pages/CreateComingSoon.tsx';
import { CompanyProfilePage } from './pages/CompanyProfile.tsx';
import { Projects } from './pages/Projects.tsx';
import { ProjectPage } from './pages/Project.tsx';
import { DocumentViewer } from './pages/DocumentViewer.tsx';
import { PolicyPage } from './pages/Policy.tsx';
import { Compare } from './pages/Compare.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrefsProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="create" element={<CreateComingSoon />} />
            <Route path="profile" element={<CompanyProfilePage />} />
            <Route path="policy" element={<PolicyPage />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/new" element={<Projects startNew />} />
            <Route path="projects/:projectId" element={<ProjectPage />} />
            <Route path="projects/:projectId/compare" element={<Compare />} />
            <Route path="projects/:projectId/documents/:documentId" element={<DocumentViewer />} />
            <Route path="*" element={<div className="card">Page not found.</div>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </PrefsProvider>
  </StrictMode>,
);
