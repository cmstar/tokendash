import { Dashboard } from './components/Dashboard.js';
import { CurrencyProvider } from './hooks/useCurrency.js';

export function App() {
  return (
    <CurrencyProvider>
      <div className="min-h-dvh bg-[radial-gradient(ellipse_at_top,#eef2ff_0%,#faf9f7_35%,#faf9f7_100%)] text-stone-900">
        <Dashboard />
      </div>
    </CurrencyProvider>
  );
}
