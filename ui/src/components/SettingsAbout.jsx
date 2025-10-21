import { useEffect, useState } from 'react';
import { getUsageMetrics, getVersion } from '../api/version';
import './SettingsAbout.css';

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

const toNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const createDefaultUsage = () => ({
  openai: {
    daily: { tokens: 0, promptTokens: 0, completionTokens: 0, resetAt: null },
    total: { tokens: 0, promptTokens: 0, completionTokens: 0, since: null },
    updatedAt: null,
  },
  elevenlabs: {
    daily: { characters: 0, resetAt: null },
    total: { characters: 0, since: null },
    updatedAt: null,
  },
  generatedAt: null,
});

const normaliseUsage = (raw) => {
  const usage = createDefaultUsage();
  if (!raw || typeof raw !== 'object') return usage;

  const openai = raw.openai ?? {};
  const openaiDaily = openai.daily ?? {};
  const openaiTotal = openai.total ?? {};
  usage.openai.daily.tokens = toNumber(openaiDaily.tokens);
  usage.openai.daily.promptTokens = toNumber(openaiDaily.prompt_tokens ?? openaiDaily.promptTokens);
  usage.openai.daily.completionTokens = toNumber(openaiDaily.completion_tokens ?? openaiDaily.completionTokens);
  usage.openai.daily.resetAt = openaiDaily.reset_at ?? openaiDaily.resetAt ?? null;
  usage.openai.total.tokens = toNumber(openaiTotal.tokens);
  usage.openai.total.promptTokens = toNumber(openaiTotal.prompt_tokens ?? openaiTotal.promptTokens);
  usage.openai.total.completionTokens = toNumber(openaiTotal.completion_tokens ?? openaiTotal.completionTokens);
  usage.openai.total.since = openaiTotal.since ?? null;
  usage.openai.updatedAt = openai.updated_at ?? openai.updatedAt ?? null;

  const eleven = raw.elevenlabs ?? {};
  const elevenDaily = eleven.daily ?? {};
  const elevenTotal = eleven.total ?? {};
  usage.elevenlabs.daily.characters = toNumber(elevenDaily.characters);
  usage.elevenlabs.daily.resetAt = elevenDaily.reset_at ?? elevenDaily.resetAt ?? null;
  usage.elevenlabs.total.characters = toNumber(elevenTotal.characters);
  usage.elevenlabs.total.since = elevenTotal.since ?? null;
  usage.elevenlabs.updatedAt = eleven.updated_at ?? eleven.updatedAt ?? null;

  usage.generatedAt = raw.generated_at ?? raw.generatedAt ?? null;
  return usage;
};

const formatNumber = (value) => numberFormatter.format(toNumber(value));

export default function SettingsAbout({ className = '', legend = 'About' }) {
  const [versions, setVersions] = useState({ app: '', python: '' });
  const [usage, setUsage] = useState(() => createDefaultUsage());

  useEffect(() => {
    let active = true;

    getVersion()
      .then((fetched) => {
        if (!active) return;
        setVersions({
          app: fetched?.app ?? '',
          python: fetched?.python ?? '',
        });
      })
      .catch(() => {
        if (!active) return;
        setVersions({ app: '', python: '' });
      });

    getUsageMetrics()
      .then((fetched) => {
        if (!active) return;
        setUsage(normaliseUsage(fetched));
      })
      .catch(() => {
        if (!active) return;
        setUsage(createDefaultUsage());
      });

    return () => {
      active = false;
    };
  }, []);

  const sectionClassName = ['settings-section', className].filter(Boolean).join(' ');
  const openaiDailyReset = usage.openai.daily.resetAt;
  const openaiTotalSince = usage.openai.total.since;
  const elevenDailyReset = usage.elevenlabs.daily.resetAt;
  const elevenTotalSince = usage.elevenlabs.total.since;

  return (
    <section className={sectionClassName} aria-label="About Blossom">
      <fieldset>
        <legend>{legend}</legend>
        <dl className="settings-about-grid">
          <div>
            <dt>App Version</dt>
            <dd>{versions.app || '—'}</dd>
          </div>
          <div>
            <dt>Python Version</dt>
            <dd>{versions.python || '—'}</dd>
          </div>
          <div className="settings-about-usage">
            <dt>OpenAI Tokens</dt>
            <dd>
              <div
                className="settings-about-usage-line"
                title={openaiDailyReset ? `UTC reset: ${openaiDailyReset}` : undefined}
              >
                <span className="settings-about-usage-label">Daily</span>
                <span className="settings-about-usage-value">
                  {formatNumber(usage.openai.daily.tokens)}
                </span>
              </div>
              <div
                className="settings-about-usage-line"
                title={openaiTotalSince ? `Tracking since: ${openaiTotalSince}` : undefined}
              >
                <span className="settings-about-usage-label">Total</span>
                <span className="settings-about-usage-value">
                  {formatNumber(usage.openai.total.tokens)}
                </span>
              </div>
            </dd>
          </div>
          <div className="settings-about-usage">
            <dt>ElevenLabs Characters</dt>
            <dd>
              <div
                className="settings-about-usage-line"
                title={elevenDailyReset ? `UTC reset: ${elevenDailyReset}` : undefined}
              >
                <span className="settings-about-usage-label">Daily</span>
                <span className="settings-about-usage-value">
                  {formatNumber(usage.elevenlabs.daily.characters)}
                </span>
              </div>
              <div
                className="settings-about-usage-line"
                title={elevenTotalSince ? `Tracking since: ${elevenTotalSince}` : undefined}
              >
                <span className="settings-about-usage-label">Total</span>
                <span className="settings-about-usage-value">
                  {formatNumber(usage.elevenlabs.total.characters)}
                </span>
              </div>
            </dd>
          </div>
        </dl>
      </fieldset>
    </section>
  );
}
