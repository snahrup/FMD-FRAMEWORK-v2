import { useState, useEffect, createContext } from 'react';
import Navigation from './components/Navigation';
import HeroSection from './components/HeroSection';
import ArchitectureSection from './components/ArchitectureSection';
import DataJourneySection from './components/DataJourneySection';
import CapabilitiesSection from './components/CapabilitiesSection';
import DashboardPagesSection from './components/DashboardPagesSection';
import ScenarioSection from './components/ScenarioSection';
import DeploymentSection from './components/DeploymentSection';

export const ThemeContext = createContext<{
  dark: boolean;
  toggle: () => void;
}>({ dark: false, toggle: () => {} });

export default function App() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('fmd-guide-theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('fmd-guide-theme', dark ? 'dark' : 'light');
  }, [dark]);

  const toggle = () => setDark((d) => !d);

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      <div className="snap-container">
        <Navigation />
        <main>
          <div className="snap-section">
            <HeroSection />
          </div>
          <div className="snap-section">
            <ArchitectureSection />
          </div>
          <div className="snap-section">
            <DataJourneySection />
          </div>
          <div className="snap-section">
            <CapabilitiesSection />
          </div>
          <div className="snap-section">
            <DashboardPagesSection />
          </div>
          <div className="snap-section">
            <ScenarioSection />
          </div>
          <div className="snap-section">
            <DeploymentSection />
          </div>

          {/* Footer */}
          <footer className="snap-section flex items-center justify-center py-16 px-6 bg-warmgray-900 dark:bg-black/40">
            <div className="max-w-5xl mx-auto text-center">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-terracotta-400 to-terracotta-600 flex items-center justify-center mx-auto mb-4">
                <span className="text-white text-lg font-bold font-mono">F</span>
              </div>
              <h3
                className="text-2xl font-semibold text-cream-200 mb-2"
                style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
              >
                FMD Framework
              </h3>
              <p className="text-sm text-warmgray-400 mb-6 max-w-md mx-auto">
                Fabric Metadata-Driven Framework. Enterprise data pipeline orchestration
                for Microsoft Fabric.
              </p>
              <div className="flex justify-center gap-6 text-xs text-warmgray-500">
                <span>4 Data Sources</span>
                <span className="text-warmgray-600">·</span>
                <span>1,700+ Entities</span>
                <span className="text-warmgray-600">·</span>
                <span>23 Pipelines</span>
                <span className="text-warmgray-600">·</span>
                <span>27 Dashboard Pages</span>
              </div>
              <div className="mt-8 pt-6 border-t border-warmgray-800">
                <p className="text-xs text-warmgray-600">
                  Built by Steve Nahrup · IP Corp · 2026
                </p>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </ThemeContext.Provider>
  );
}
