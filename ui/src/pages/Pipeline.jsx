import BackButton from '../components/BackButton.jsx';

const PIPELINE_STEPS = [
  {
    title: 'Curate Inputs',
    detail:
      'Gather prompts, reference clips, and project metadata so every downstream tool starts with the same creative brief.',
  },
  {
    title: 'Arrange Tasks',
    detail:
      'Queue voice training, music generation, diffusion renders, and post-processing jobs in the order they should execute.',
  },
  {
    title: 'Review Outputs',
    detail:
      'Inspect intermediate renders, flag revisions, and capture notes before promoting assets to the next stage.',
  },
  {
    title: 'Publish & Share',
    detail:
      'Export approved assets, notify collaborators, and push deliverables into campaigns or release folders.',
  },
];

const PIPELINE_TIPS = [
  'Use consistent labels so queue items, gallery entries, and exports stay linked to the same initiative.',
  'Pin critical steps like mastering or transcription to guarantee they run even if you reroute earlier tasks.',
  'Automate notifications with Discord or email webhooks when long-running stages complete.',
];

export default function Pipeline() {
  return (
    <>
      <BackButton />
      <h1>Pipeline</h1>
      <p style={{ maxWidth: '60ch', margin: '0 auto', padding: '0 var(--space-xl)' }}>
        Coordinate multi-step production runs across Blossom. Pipelines keep music generation, vocal work, and supporting assets
        synchronized so teams can move from concept to final mix without losing context.
      </p>
      <section
        style={{
          padding: 'var(--space-xl)',
          display: 'grid',
          gap: 'var(--space-xl)',
          maxWidth: '960px',
          margin: '0 auto',
          alignContent: 'start',
        }}
      >
        <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
          <h2>Pipeline stages</h2>
          <ol style={{ display: 'grid', gap: 'var(--space-md)', paddingLeft: '1.25rem' }}>
            {PIPELINE_STEPS.map((step) => (
              <li key={step.title} style={{ display: 'grid', gap: '0.25rem' }}>
                <h3 style={{ margin: 0 }}>{step.title}</h3>
                <p style={{ margin: 0 }}>{step.detail}</p>
              </li>
            ))}
          </ol>
        </div>
        <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
          <h2>Operating tips</h2>
          <ul style={{ display: 'grid', gap: '0.5rem', paddingLeft: '1.25rem' }}>
            {PIPELINE_TIPS.map((tip) => (
              <li key={tip} style={{ margin: 0 }}>{tip}</li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
