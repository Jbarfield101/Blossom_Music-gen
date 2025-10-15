import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

const INTRO_MESSAGE = 'Ask about your campaign world, its locations, or the characters you have met.';

export default function DndChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const listRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    const node = listRef.current;
    if (!node) return;
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  const sendMessage = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || pending) return;
    setPending(true);
    setStatus('Consulting the archives…');
    setError('');
    setMessages((prev) => prev.concat({ role: 'user', content: prompt }));
    setInput('');
    try {
      const reply = await invoke('dnd_chat_message', { message: prompt });
      const text = typeof reply === 'string' ? reply : reply == null ? '' : String(reply);
      setMessages((prev) => prev.concat({ role: 'assistant', content: text }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const rendered = `Error: ${message}`;
      setError(rendered);
      setMessages((prev) => prev.concat({ role: 'assistant', content: rendered }));
    } finally {
      setPending(false);
      setStatus('');
      scrollToBottom();
    }
  }, [input, pending, scrollToBottom]);

  const handleSubmit = (event) => {
    event.preventDefault();
    sendMessage();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      <BackButton />
      <h1>Dungeons &amp; Dragons &middot; Chat</h1>
      <section className="dashboard" style={{ padding: '1rem' }}>
        <section className="dnd-chat-panel">
          <p className="muted" style={{ margin: 0 }}>
            {INTRO_MESSAGE} Non-campaign topics will be politely declined.
          </p>
          {status && (
            <div className="dnd-chat-status" role="status">
              {status}
            </div>
          )}
          {error && (
            <div className="dnd-chat-error" role="alert">
              {error}
            </div>
          )}
          <div className="dnd-chat-history" ref={listRef}>
            {messages.length === 0 ? (
              <div className="muted">Begin a conversation to receive a narrated reply.</div>
            ) : (
              messages.map((entry, index) => (
                <div key={`${entry.role}-${index}`} className={`dnd-chat-message ${entry.role}`}>
                  <div className="dnd-chat-role">{entry.role === 'user' ? 'You' : 'Blossom'}</div>
                  <div className="dnd-chat-bubble">{entry.content}</div>
                </div>
              ))
            )}
          </div>
          <form className="dnd-chat-form" onSubmit={handleSubmit}>
            <textarea
              rows={4}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Share a lore prompt, ask about an NPC, or describe the world…"
              disabled={pending}
            />
            <div className="dnd-chat-actions">
              <button type="submit" className="p-sm" disabled={pending || !input.trim()}>
                {pending ? 'Weaving the tale…' : 'Send'}
              </button>
            </div>
          </form>
        </section>
      </section>
    </>
  );
}
