import { useState, useEffect, useContext } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Moon } from 'lucide-react';
import { ThemeContext } from '../App';

const sections = [
  { id: 'hero', label: 'Overview' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'journey', label: 'Data Journey' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'pages', label: 'Dashboard' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'deployment', label: 'Deployment' },
];

export default function Navigation() {
  const [active, setActive] = useState('hero');
  const [scrolled, setScrolled] = useState(false);
  const { dark, toggle } = useContext(ThemeContext);

  useEffect(() => {
    const container = document.querySelector('.snap-container');
    if (!container) return;

    const onScroll = () => {
      setScrolled(container.scrollTop > 60);

      const positions = sections.map((s) => {
        const el = document.getElementById(s.id);
        if (!el) return { id: s.id, top: Infinity };
        return { id: s.id, top: el.getBoundingClientRect().top };
      });

      const current = positions.reduce((closest, pos) => {
        if (pos.top <= 200 && pos.top > closest.top) return pos;
        return closest;
      }, { id: 'hero', top: -Infinity });

      setActive(current.id);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'bg-cream-100/80 dark:bg-warmgray-900/80 backdrop-blur-xl border-b border-cream-300 dark:border-warmgray-700 shadow-warm-sm'
          : 'bg-transparent'
      }`}
      initial={{ y: -80 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <AnimatePresence>
          {scrolled && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex items-center gap-3"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-terracotta-400 to-terracotta-600 flex items-center justify-center">
                <span className="text-white text-xs font-bold font-mono">F</span>
              </div>
              <span className="font-serif text-warmgray-800 dark:text-cream-200 text-sm font-semibold tracking-tight">
                FMD Framework
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dots + labels */}
        <div className="flex items-center gap-6">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="group flex items-center gap-2 py-2"
            >
              <div className={`nav-dot ${active === s.id ? 'active' : ''}`} />
              <span
                className={`text-xs font-medium transition-colors duration-300 ${
                  active === s.id
                    ? 'text-terracotta-500'
                    : 'text-warmgray-400 dark:text-warmgray-500 group-hover:text-warmgray-600 dark:group-hover:text-warmgray-300'
                }`}
              >
                {s.label}
              </span>
            </button>
          ))}

          {/* Theme toggle */}
          <button
            onClick={toggle}
            className="ml-4 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300
              bg-cream-200 dark:bg-warmgray-700 hover:bg-cream-300 dark:hover:bg-warmgray-600
              border border-cream-400 dark:border-warmgray-600"
            aria-label="Toggle theme"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={dark ? 'moon' : 'sun'}
                initial={{ scale: 0, rotate: -90 }}
                animate={{ scale: 1, rotate: 0 }}
                exit={{ scale: 0, rotate: 90 }}
                transition={{ duration: 0.2 }}
              >
                {dark ? (
                  <Moon size={16} className="text-terracotta-300" />
                ) : (
                  <Sun size={16} className="text-terracotta-500" />
                )}
              </motion.div>
            </AnimatePresence>
          </button>
        </div>
      </div>
    </motion.nav>
  );
}
