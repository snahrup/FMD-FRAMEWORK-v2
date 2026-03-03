import { motion } from 'framer-motion';
import { useEffect, useState, useContext } from 'react';
import { ThemeContext } from '../App';

const layers = [
  { label: 'Sources', color: '#7A756B', x: 0 },
  { label: 'Landing Zone', color: '#C75B3A', x: 1 },
  { label: 'Bronze', color: '#CD7F32', x: 2 },
  { label: 'Silver', color: '#8B99A8', x: 3 },
  { label: 'Gold', color: '#D4AF37', x: 4 },
];

interface Particle {
  id: number;
  fromLayer: number;
  delay: number;
}

export default function HeroSection() {
  const { dark } = useContext(ThemeContext);
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    let id = 0;
    const interval = setInterval(() => {
      const fromLayer = Math.floor(Math.random() * 4);
      setParticles((prev) => {
        const next = [...prev, { id: id++, fromLayer, delay: 0 }];
        return next.slice(-20); // keep max 20
      });
    }, 600);
    return () => clearInterval(interval);
  }, []);

  return (
    <section id="hero" className="relative h-screen flex flex-col items-center justify-center overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-cream-50 via-cream-100 to-cream-200 dark:from-warmgray-900 dark:via-[#1E1D1A] dark:to-warmgray-800 transition-colors duration-500" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.06]"
        style={{
          backgroundImage: dark
            ? 'linear-gradient(rgba(201,91,58,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(201,91,58,0.5) 1px, transparent 1px)'
            : 'linear-gradient(rgba(120,100,80,1) 1px, transparent 1px), linear-gradient(90deg, rgba(120,100,80,1) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      {/* Content */}
      <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-8"
        >
          <span className="badge-terracotta text-[11px]">Microsoft Fabric Enterprise Framework</span>
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="font-serif text-5xl md:text-7xl lg:text-8xl font-bold text-warmgray-900 dark:text-cream-100 tracking-tight leading-[1.05] mb-6"
          style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
        >
          FMD Framework
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.25 }}
          className="text-xl md:text-2xl text-warmgray-500 dark:text-warmgray-400 max-w-3xl mx-auto leading-relaxed mb-4"
        >
          A metadata-driven data pipeline framework that moves{' '}
          <span className="text-terracotta-500 font-medium">1,700+ tables</span> from on-prem
          databases through a complete medallion architecture — automatically.
        </motion.p>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35 }}
          className="text-base text-warmgray-400 max-w-2xl mx-auto mb-16"
        >
          Register once. Transform everywhere. Monitor in real time.
        </motion.p>

        {/* Animated medallion flow */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.5 }}
          className="relative w-full max-w-4xl mx-auto"
        >
          <svg viewBox="0 0 900 200" className="w-full">
            {/* Connection lines */}
            {layers.slice(0, -1).map((layer, i) => {
              const x1 = layer.x * 210 + 100;
              const x2 = layers[i + 1].x * 210 + 100;
              return (
                <line
                  key={`line-${i}`}
                  x1={x1}
                  y1={100}
                  x2={x2}
                  y2={100}
                  stroke={layer.color}
                  strokeWidth="2"
                  strokeOpacity="0.2"
                />
              );
            })}

            {/* Animated flow lines */}
            {layers.slice(0, -1).map((layer, i) => {
              const x1 = layer.x * 210 + 100;
              const x2 = layers[i + 1].x * 210 + 100;
              return (
                <line
                  key={`flow-${i}`}
                  x1={x1}
                  y1={100}
                  x2={x2}
                  y2={100}
                  stroke={layers[i + 1].color}
                  strokeWidth="2"
                  strokeOpacity="0.5"
                  className="flow-line"
                  style={{ animationDelay: `${i * 0.3}s` }}
                />
              );
            })}

            {/* Particles */}
            {particles.map((p) => {
              const startX = p.fromLayer * 210 + 100;
              const endX = (p.fromLayer + 1) * 210 + 100;
              return (
                <motion.circle
                  key={p.id}
                  r="4"
                  fill={layers[p.fromLayer + 1].color}
                  initial={{ cx: startX, cy: 100, opacity: 0, scale: 0 }}
                  animate={{ cx: endX, cy: 100, opacity: [0, 1, 1, 0], scale: [0, 1.2, 1, 0] }}
                  transition={{ duration: 1.5, ease: 'easeInOut' }}
                />
              );
            })}

            {/* Layer nodes */}
            {layers.map((layer) => {
              const cx = layer.x * 210 + 100;
              return (
                <g key={layer.label}>
                  {/* Glow */}
                  <circle cx={cx} cy={100} r="36" fill={layer.color} opacity="0.06" />
                  <circle cx={cx} cy={100} r="28" fill={layer.color} opacity="0.1" />
                  {/* Node */}
                  <motion.circle
                    cx={cx}
                    cy={100}
                    r="20"
                    fill={dark ? '#2E2B27' : 'white'}
                    stroke={layer.color}
                    strokeWidth="2.5"
                    whileHover={{ scale: 1.15 }}
                    className="cursor-pointer"
                  />
                  <circle cx={cx} cy={100} r="8" fill={layer.color} opacity="0.6" />
                  {/* Label */}
                  <text
                    x={cx}
                    y={155}
                    textAnchor="middle"
                    fill={dark ? '#B3ADA3' : '#4A4640'}
                    fontSize="13"
                    fontWeight="500"
                    fontFamily="Inter, system-ui, sans-serif"
                  >
                    {layer.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        className="absolute bottom-10 left-1/2 -translate-x-1/2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="flex flex-col items-center gap-2"
        >
          <span className="text-xs text-warmgray-400 tracking-widest uppercase">Scroll to explore</span>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 4 L10 14 M6 10 L10 14 L14 10" stroke="#999488" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.div>
      </motion.div>
    </section>
  );
}
