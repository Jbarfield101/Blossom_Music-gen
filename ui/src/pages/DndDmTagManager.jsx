import BackButton from '../components/BackButton.jsx';
import { TAGS } from '../lib/dndTags.js';
import './Dnd.css';

export default function DndDmTagManager() {
  return (
    <>
      <BackButton />
      <main className="dnd-tag-manager">
        <h1>Dungeons & Dragons · Tag Manager</h1>
        <p className="dnd-tag-manager-intro">
          Use this baseline tag set to organize notes, quests, and lore across your campaign.
          These shared labels keep every card and file searchable while giving you a foundation
          you can expand with custom tags as your world grows.
        </p>
        <div className="dnd-tag-manager-tags" role="list">
          {TAGS.map((tag) => (
            <span key={tag} className="dnd-tag-chip" role="listitem">
              {tag}
            </span>
          ))}
        </div>
      </main>
    </>
  );
}
