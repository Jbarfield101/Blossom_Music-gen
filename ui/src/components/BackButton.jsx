import { useNavigate } from 'react-router-dom';

export default function BackButton() {
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };
  return (
    <button type="button" onClick={goBack} className="back-button">
      Back
    </button>
  );
}
