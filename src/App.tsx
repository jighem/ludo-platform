import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import { LeagueProvider } from './context/LeagueContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Leaderboards } from './pages/Leaderboards';
import { MatchHistory } from './pages/MatchHistory';
import { PlayersPage } from './pages/PlayersPage';
import { PlayerProfile } from './pages/PlayerProfile';
import { HeadToHeadPage } from './pages/HeadToHeadPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { MonthlyAwardsPage } from './pages/MonthlyAwardsPage';
import { SettingsPage } from './pages/SettingsPage';
import { InstallationPage } from './pages/InstallationPage';
import { PlayLudoPage } from './pages/PlayLudoPage';
import { NewMatchModal } from './components/NewMatchModal';
import { AddPlayerModal } from './components/AddPlayerModal';
import { LoginModal } from './components/LoginModal';
import { FirstAdminSetup } from './components/FirstAdminSetup';
import { useLeague } from './context/LeagueContext';
import { initNetworkAutoSync } from './utils/ludoOfflineSync';

function MainApp() {
  const { needsSetup, loading, user } = useAuth();
  const { appName } = useSettings();
  const { triggerDataRefresh } = useLeague();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);

  // Auto-sync any pending offline matches whenever network is restored
  useEffect(() => {
    const unsub = initNetworkAutoSync(() => {
      triggerDataRefresh();
    });
    return () => {
      unsub();
    };
  }, [triggerDataRefresh]);

  // Modals
  const [isNewMatchOpen, setIsNewMatchOpen] = useState(false);
  const [isAddPlayerOpen, setIsAddPlayerOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Dark Mode preference
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('ludo_theme');
    if (saved) return saved === 'dark';
    return true; // Default to dark Bento Grid theme
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('ludo_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('ludo_theme', 'light');
    }
  }, [darkMode]);

  const handleSelectPlayer = (playerId: number) => {
    setSelectedPlayerId(playerId);
    setActiveTab('player-profile');
  };

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'play-ludo':
        return (
          <PlayLudoPage
            onNavigateTab={setActiveTab}
            onOpenNewMatch={() => setIsNewMatchOpen(true)}
            onOpenLogin={() => setIsLoginOpen(true)}
          />
        );
      case 'dashboard':
        return (
          <Dashboard
            onOpenNewMatch={() => setIsNewMatchOpen(true)}
            onSelectPlayer={handleSelectPlayer}
            onNavigateTab={setActiveTab}
          />
        );
      case 'leaderboards':
        return (
          <Leaderboards
            onSelectPlayer={handleSelectPlayer}
            onOpenNewMatch={() => setIsNewMatchOpen(true)}
          />
        );
      case 'matches':
        return (
          <MatchHistory
            onOpenNewMatch={() => setIsNewMatchOpen(true)}
            onSelectPlayer={handleSelectPlayer}
          />
        );
      case 'players':
        return (
          <PlayersPage
            onSelectPlayer={handleSelectPlayer}

          />
        );
      case 'player-profile':
        return (
          <PlayerProfile
            playerId={selectedPlayerId}
            onBack={() => setActiveTab('players')}
          />
        );
      case 'head-to-head':
        return <HeadToHeadPage />;
      case 'analytics':
        return <AnalyticsPage onSelectPlayer={handleSelectPlayer} />;
      case 'awards':
        return <MonthlyAwardsPage onSelectPlayer={handleSelectPlayer} />;
      case 'settings':
        return user?.role === 'admin' ? (
          <SettingsPage />
        ) : (
          <Dashboard
            onOpenNewMatch={() => setIsNewMatchOpen(true)}
            onSelectPlayer={handleSelectPlayer}
            onNavigateTab={setActiveTab}
          />
        );
      case 'installation':
        return user?.role === 'admin' ? (
          <InstallationPage />
        ) : (
          <Dashboard
            onOpenNewMatch={() => setIsNewMatchOpen(true)}
            onSelectPlayer={handleSelectPlayer}
            onNavigateTab={setActiveTab}
          />
        );
      default:
        return (
          <Dashboard
            onOpenNewMatch={() => setIsNewMatchOpen(true)}
            onSelectPlayer={handleSelectPlayer}
            onNavigateTab={setActiveTab}
          />
        );
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-bold text-zinc-400">Initializing {appName}...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-zinc-950 dark:text-zinc-100 flex flex-col font-sans transition-colors duration-200">
      {/* First Admin Setup Modal overlay if system not setup */}
      {needsSetup && <FirstAdminSetup />}

      {/* Main App Navigation Header */}
      <Header
        appName={appName}
        onOpenNewMatch={() => setIsNewMatchOpen(true)}
        onOpenLogin={() => setIsLoginOpen(true)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        onToggleMobileMenu={() => setIsMobileMenuOpen((prev) => !prev)}
      />

      {/* Main Container Layout */}
      <div className="flex-1 max-w-7xl w-full mx-auto flex flex-col md:flex-row p-3 sm:p-6 gap-4 sm:gap-6">
        <Sidebar
          activeTab={activeTab}
          setActiveTab={(tab) => {
            setActiveTab(tab);
            setIsMobileMenuOpen(false);
          }}
          isMobileOpen={isMobileMenuOpen}
          onCloseMobile={() => setIsMobileMenuOpen(false)}
        />

        <main className="flex-1 min-w-0">
          {renderActiveTab()}
        </main>
      </div>

      {/* Modals */}
      <NewMatchModal
        isOpen={isNewMatchOpen}
        onClose={() => setIsNewMatchOpen(false)}
        onMatchSaved={() => {
          // Data is refreshed reactively via LeagueContext
        }}
      />

      <AddPlayerModal
        isOpen={isAddPlayerOpen}
        onClose={() => setIsAddPlayerOpen(false)}
        onPlayerAdded={() => {
          setIsAddPlayerOpen(false);
        }}
      />

      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <LeagueProvider>
        <SettingsProvider>
          <MainApp />
        </SettingsProvider>
      </LeagueProvider>
    </AuthProvider>
  );
}
