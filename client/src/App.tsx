import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PresentationApp } from "./presentation/PresentationApp";
import { AdminLayout } from "./admin/AdminLayout";
import { ImportMappingPage } from "./admin/ImportMappingPage";
import { SourcesPage } from "./admin/SourcesPage";
import { ThresholdsPage } from "./admin/ThresholdsPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PresentationApp />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<ImportMappingPage />} />
          <Route path="sources" element={<SourcesPage />} />
          <Route path="thresholds" element={<ThresholdsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
