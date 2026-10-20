import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PrefsProvider } from './lib/prefs.tsx';
import { Layout, PublicLayout } from './components/Layout.tsx';
import { AcceptInvite, Login, Signup } from './pages/Auth.tsx';
import { Team } from './pages/Team.tsx';
import { Home } from './pages/Home.tsx';
import { CreateStart, DraftWizard } from './pages/Create.tsx';
import { CompanyProfilePage } from './pages/CompanyProfile.tsx';
import { Projects } from './pages/Projects.tsx';
import { ProjectPage } from './pages/Project.tsx';
import { DocumentViewer } from './pages/DocumentViewer.tsx';
import { PolicyPage } from './pages/Policy.tsx';
import { Compare } from './pages/Compare.tsx';
import { Library } from './pages/Library.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrefsProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="login" element={<Login />} />
            <Route path="signup" element={<Signup />} />
            <Route path="invite/:token" element={<AcceptInvite />} />
          </Route>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="create" element={<CreateStart />} />
            <Route path="create/:draftId" element={<DraftWizard />} />
            <Route path="profile" element={<CompanyProfilePage />} />
            <Route path="policy" element={<PolicyPage />} />
            <Route path="library" element={<Library />} />
            <Route path="team" element={<Team />} />
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
