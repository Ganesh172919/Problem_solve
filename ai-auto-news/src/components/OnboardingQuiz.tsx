'use client';

import { useState, useEffect } from 'react';

const TOPIC_OPTIONS = [
  { id: 'ai-ml', label: '🤖 AI & Machine Learning', desc: 'Models, training, AI safety' },
  { id: 'llms', label: '💬 Large Language Models', desc: 'GPT, Claude, Gemini, open models' },
  { id: 'startups', label: '🚀 Startups & VC', desc: 'Funding rounds, founders, exits' },
  { id: 'hardware', label: '⚡ Chips & Hardware', desc: 'NVIDIA, AMD, custom silicon' },
  { id: 'security', label: '🔐 Cybersecurity', desc: 'Breaches, AI security, zero-day' },
  { id: 'open-source', label: '🌐 Open Source', desc: 'GitHub, OSS projects, communities' },
  { id: 'big-tech', label: '🏢 Big Tech', desc: 'Google, Apple, Meta, Microsoft' },
  { id: 'ai-tools', label: '🛠️ AI Tools', desc: 'Copilots, agents, automation' },
];

const TONE_OPTIONS = [
  { id: 'quick', label: 'Quick & Punchy', desc: 'Short articles, key facts only.', icon: '⚡' },
  { id: 'balanced', label: 'Balanced', desc: 'Mix of breaking news and in-depth.', icon: '⚖️' },
  { id: 'technical', label: 'Deep & Technical', desc: 'Full analyses, research explainers.', icon: '🔬' },
];

const FREQUENCY_OPTIONS = [
  { id: 'breaking', label: 'Breaking News', desc: 'New articles every hour.', icon: '🔔' },
  { id: 'daily', label: 'Daily Digest', desc: '3–4 articles per day.', icon: '📰' },
  { id: 'weekly', label: 'Deep Dives', desc: '2–3 times per week, long-form.', icon: '📚' },
];

type Step = 1 | 2 | 3;

export default function OnboardingQuiz({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const [topics, setTopics] = useState<string[]>([]);
  const [tone, setTone] = useState('balanced');
  const [frequency, setFrequency] = useState('daily');
  const [submitting, setSubmitting] = useState(false);

  const toggleTopic = (id: string) => {
    setTopics((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topics: JSON.stringify(topics),
          tone,
          frequency,
        }),
      });
    } catch {
      // Non-fatal — preferences are best-effort
    }
    onComplete();
  };

  const handleSkip = async () => {
    try {
      await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topics: '[]', tone: 'balanced', frequency: 'daily', skipped: true }),
      });
    } catch { /* ignore */ }
    onComplete();
  };

  return (
    <div className="quiz-overlay" role="dialog" aria-label="Set up your feed">
      <div className="quiz-modal">
        {/* Progress */}
        <div className="quiz-progress">
          <div className={`quiz-progress-step ${step >= 1 ? (step > 1 ? 'done' : 'active') : ''}`} />
          <div className={`quiz-progress-step ${step >= 2 ? (step > 2 ? 'done' : 'active') : ''}`} />
          <div className={`quiz-progress-step ${step >= 3 ? 'active' : ''}`} />
        </div>

        {/* Step 1: Topics */}
        {step === 1 && (
          <div>
            <h2>What interests you?</h2>
            <p>Select at least one topic to personalize your feed.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
              {TOPIC_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`quiz-chip ${topics.includes(opt.id) ? 'selected' : ''}`}
                  onClick={() => toggleTopic(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn-primary"
                disabled={topics.length === 0}
                onClick={() => setStep(2)}
                style={{ opacity: topics.length === 0 ? 0.5 : 1 }}
              >
                Continue
              </button>
              <button type="button" className="btn-ghost" onClick={handleSkip}>
                Skip — show me everything
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Tone */}
        {step === 2 && (
          <div>
            <h2>How do you like your news?</h2>
            <p>Choose the writing style that suits you best.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
              {TONE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`quiz-card-option ${tone === opt.id ? 'selected' : ''}`}
                  onClick={() => setTone(opt.id)}
                  style={{ textAlign: 'left' }}
                >
                  <h3>{opt.icon} {opt.label}</h3>
                  <p>{opt.desc}</p>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn-ghost" onClick={() => setStep(1)}>Back</button>
              <button type="button" className="btn-primary" onClick={() => setStep(3)}>Continue</button>
            </div>
          </div>
        )}

        {/* Step 3: Frequency */}
        {step === 3 && (
          <div>
            <h2>How often?</h2>
            <p>Choose how frequently you want new content.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
              {FREQUENCY_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`quiz-card-option ${frequency === opt.id ? 'selected' : ''}`}
                  onClick={() => setFrequency(opt.id)}
                  style={{ textAlign: 'left' }}
                >
                  <h3>{opt.icon} {opt.label}</h3>
                  <p>{opt.desc}</p>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn-ghost" onClick={() => setStep(2)}>Back</button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? 'Setting up...' : 'Start reading →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
