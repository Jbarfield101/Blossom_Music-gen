import { useState } from 'react';
import AlgorithmicGenerator from './Generate.jsx';
import PhraseModel from './PhraseModel.jsx';
import BackButton from '../components/BackButton.jsx';

export default function MusicGenerator() {
  const [activeTab, setActiveTab] = useState('algorithmic');

  return (
    <>
      <header>
        <BackButton />
        <h1>Music Generator</h1>
        <nav className="tabs">
          <button
            className={activeTab === 'algorithmic' ? 'active' : ''}
            onClick={() => setActiveTab('algorithmic')}
          >
            Algorithmic
          </button>
          <button
            className={activeTab === 'phrase' ? 'active' : ''}
            onClick={() => setActiveTab('phrase')}
          >
            Phrase Model
          </button>
        </nav>
      </header>
      <section>
        <section hidden={activeTab !== 'algorithmic'}>
          <AlgorithmicGenerator />
        </section>
        <section hidden={activeTab !== 'phrase'}>
          <PhraseModel />
        </section>
      </section>
    </>
  );
}

