import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import './Dnd.css';

const bankSections = [
  {
    to: '/dnd/world/bank/economy',
    icon: 'Landmark',
    title: 'Economy',
    description: 'Balance currencies, reserves, and realm-wide funds.',
  },
  {
    to: '/dnd/world/bank/transactions',
    icon: 'Receipt',
    title: 'Transactions',
    description: 'Review deposits, withdrawals, and ledger activity.',
  },
];

export default function DndWorldBank() {
  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Bank</h1>
      <section className="dashboard dnd-card-grid">
        {bankSections.map(({ to, icon, title, description }) => (
          <Card key={to} to={to} icon={icon} title={title}>
            {description}
          </Card>
        ))}
      </section>
    </>
  );
}
