"use client";

import { useEffect, useMemo, useState } from "react";

type ApiMessage = Record<string, unknown>;
type ApiToken = Record<string, unknown>;

const defaultAttachments = [
  {
    file_name: "notes.pdf",
    file_url: "https://cdn.example.com/notes.pdf",
    mime_type: "application/pdf",
  },
  {
    file_name: "xray.png",
    file_url: "https://cdn.example.com/xray.png",
    mime_type: "image/png",
    size: 234_000,
  },
];

const defaultAttachmentsJson = JSON.stringify(defaultAttachments, null, 2);

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const wsEndpoint = process.env.NEXT_PUBLIC_WS_BASE_URL ?? "ws://localhost:8000/ws";

const readJsonSafe = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

export default function Home() {
  const [locationID, setLocationID] = useState("");
  const [contactID, setContactID] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [messageText, setMessageText] = useState("");
  const [attachmentsInput, setAttachmentsInput] = useState(defaultAttachmentsJson);
  const [direction, setDirection] = useState("");
  const [unreadBy, setUnreadBy] = useState("");
  const [limit, setLimit] = useState("30");
  const [offset, setOffset] = useState("0");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [tokenExpiresAt, setTokenExpiresAt] = useState("");
  const [messages, setMessages] = useState<ApiMessage[]>([]);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [wsFeed, setWsFeed] = useState<string[]>([]);

  const headers = useMemo<Record<string, string>>(() => {
    const base: Record<string, string> = {};
    if (authToken.trim()) {
      base.Authorization = `Bearer ${authToken.trim()}`;
    }
    return base;
  }, [authToken]);

  const appendLog = (entry: string) => {
    setStatusLog((prev) => {
      const next = [`${new Date().toLocaleTimeString()} · ${entry}`, ...prev];
      return next.slice(0, 8);
    });
  };

  const ensureIds = () => {
    if (!locationID || !contactID) {
      appendLog("set locationID and contactID first");
      return false;
    }
    return true;
  };

  const parseAttachments = () => {
    if (attachmentsInput.trim() === "") {
      return [];
    }
    try {
      const parsed = JSON.parse(attachmentsInput);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      appendLog("attachments must be a JSON array");
      return null;
    } catch {
      appendLog("attachments JSON invalid");
      return null;
    }
  };

  const buildQuery = () => {
    const params = new URLSearchParams();
    params.set("locationID", locationID);
    params.set("contactID", contactID);
    if (limit) {
      params.set("limit", limit);
    }
    if (offset) {
      params.set("offset", offset);
    }
    if (direction) {
      params.set("direction", direction);
    }
    if (unreadBy) {
      params.set("unreadBy", unreadBy);
    }
    if (startTime) {
      params.set("startTime", new Date(startTime).toISOString());
    }
    if (endTime) {
      params.set("endTime", new Date(endTime).toISOString());
    }
    return params;
  };

  const listMessages = async () => {
    if (!ensureIds()) {
      return;
    }
    try {
      const response = await fetch(
        `${apiBase}/location-contact-chat/messages?${buildQuery().toString()}`,
        { headers }
      );
      const payload = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error((payload as Record<string, unknown>).message as string);
      }
      const list = (payload as Record<string, unknown>).messages;
      setMessages(Array.isArray(list) ? list : []);
      appendLog(`listed ${Array.isArray(list) ? list.length : 0} messages`);
    } catch (error) {
      appendLog(`list failed: ${(error as Error).message}`);
    }
  };

  const sendMessage = async () => {
    if (!ensureIds() || !messageText.trim()) {
      appendLog("provide content to send");
      return;
    }
    const attachments = parseAttachments();
    if (attachments === null) {
      return;
    }
    const payload = {
      location_id: locationID,
      contact_id: contactID,
      content: messageText.trim(),
      attachments,
    };
    try {
      const response = await fetch(`${apiBase}/location-contact-chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(payload),
      });
      const body = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error((body as Record<string, unknown>).message as string);
      }
      if ((body as Record<string, unknown>).message) {
        setMessages((prev) => [(body as Record<string, unknown>).message as ApiMessage, ...prev]);
      }
      appendLog("message sent");
    } catch (error) {
      appendLog(`send failed: ${(error as Error).message}`);
    }
  };

  const createToken = async () => {
    if (!ensureIds()) {
      return;
    }
    const payload: Record<string, string> = {
      location_id: locationID,
      contact_id: contactID,
    };
    if (tokenExpiresAt) {
      payload.expires_at = new Date(tokenExpiresAt).toISOString();
    }
    try {
      const response = await fetch(`${apiBase}/location-contact-chat/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await readJsonSafe(response);
        throw new Error((body as Record<string, unknown>).message as string);
      }
      appendLog("token created");
      listTokens();
    } catch (error) {
      appendLog(`token create failed: ${(error as Error).message}`);
    }
  };

  const listTokens = async () => {
    if (!ensureIds()) {
      return;
    }
    try {
      const response = await fetch(
        `${apiBase}/location-contact-chat/tokens?locationID=${locationID}&contactID=${contactID}`,
        { headers }
      );
      const payload = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error((payload as Record<string, unknown>).message as string);
      }
      const list = (payload as Record<string, unknown>).tokens;
      setTokens(Array.isArray(list) ? list : []);
      appendLog(`listed ${Array.isArray(list) ? list.length : 0} tokens`);
    } catch (error) {
      appendLog(`token list failed: ${(error as Error).message}`);
    }
  };

  const invalidateToken = async (id: string) => {
    try {
      const response = await fetch(
        `${apiBase}/location-contact-chat/tokens/${id}/invalidate`,
        {
          method: "POST",
          headers,
        }
      );
      if (!response.ok) {
        const payload = await readJsonSafe(response);
        throw new Error((payload as Record<string, unknown>).message as string);
      }
      appendLog(`token ${id} invalidated`);
      listTokens();
    } catch (error) {
      appendLog(`invalidate failed: ${(error as Error).message}`);
    }
  };

  useEffect(() => {
    const socket = new WebSocket(wsEndpoint);
    socket.addEventListener("open", () => appendLog("websocket connected"));
    socket.addEventListener("message", (event) => {
      setWsFeed((prev) => {
        const next = [`${new Date().toLocaleTimeString()} · ${event.data}`, ...prev];
        return next.slice(0, 6);
      });
    });
    socket.addEventListener("close", () => appendLog("websocket closed"));
    socket.addEventListener("error", () => appendLog("websocket error"));
    return () => socket.close();
  }, []);

  const renderTimestamp = (message: ApiMessage) =>
    (message.created_at as string) ?? (message.createdAt as string) ?? "unknown";
  const renderSender = (message: ApiMessage) =>
    (message.sender_name as string) ?? (message.sender_type as string) ?? "unknown";

  return (
    <main className="app-shell">
      <header className="hero-card">
        <p className="eyebrow">Location Contact Chat Lab</p>
        <h1>Push the REST layer, watch the websocket fan-out</h1>
        <p className="hero-sub">
          Use these boards to generate tokens, send manual messages, and monitor the websocket feed
          that responds to notify() calls.
        </p>
      </header>

      <section className="section-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Context</p>
            <h2>Identity &amp; filters</h2>
          </div>
          <div className="pill">API base: {apiBase}</div>
        </div>
        <div className="form-grid">
          <label>
            JWT / Auth token
            <input
              type="password"
              placeholder="Bearer ..."
              value={authToken}
              onChange={(event) => setAuthToken(event.target.value)}
            />
          </label>
          <label>
            Location ID
            <input type="text" value={locationID} onChange={(event) => setLocationID(event.target.value)} />
          </label>
          <label>
            Contact ID
            <input type="text" value={contactID} onChange={(event) => setContactID(event.target.value)} />
          </label>
          <label>
            Limit
            <input type="number" min={1} value={limit} onChange={(event) => setLimit(event.target.value)} />
          </label>
          <label>
            Offset
            <input type="number" min={0} value={offset} onChange={(event) => setOffset(event.target.value)} />
          </label>
          <label>
            Direction filter
            <select value={direction} onChange={(event) => setDirection(event.target.value)}>
              <option value="">any</option>
              <option value="location">location</option>
              <option value="contact">contact</option>
            </select>
          </label>
          <label>
            Unread by
            <select value={unreadBy} onChange={(event) => setUnreadBy(event.target.value)}>
              <option value="">any</option>
              <option value="location">location</option>
              <option value="contact">contact</option>
            </select>
          </label>
          <label>
            Start time
            <input type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
          </label>
          <label>
            End time
            <input type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
          </label>
        </div>
        <div className="action-row">
          <button type="button" onClick={listMessages} className="primary">
            Pull messages
          </button>
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              appendLog("cleared list");
            }}
            className="ghost"
          >
            Clear messages
          </button>
        </div>
      </section>

      <section className="section-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Message Studio</p>
            <h2>Send + preview</h2>
          </div>
          <div className="pill">Websocket: {wsEndpoint}</div>
        </div>
        <textarea
          className="payload"
          rows={4}
          value={messageText}
          placeholder="Hello, this is a quick test"
          onChange={(event) => setMessageText(event.target.value)}
        />
        <label className="wide">
          Attachment JSON
          <textarea
            value={attachmentsInput}
            onChange={(event) => setAttachmentsInput(event.target.value)}
            rows={6}
            className="payload"
          />
        </label>
        <div className="action-row">
          <button type="button" onClick={sendMessage} className="primary">
            Send message
          </button>
          <button
            type="button"
            onClick={() => {
              setMessageText(" ");
              appendLog("cleared composer");
            }}
            className="ghost"
          >
            Reset composer
          </button>
        </div>
        <div className="list-grid">
          {messages.map((message, index) => {
            const key = `${renderTimestamp(message)}-${index}`;
            return (
              <article key={key} className="list-card">
                <p className="meta">{renderTimestamp(message)}</p>
                <p className="title">{renderSender(message)}</p>
                <pre>{JSON.stringify(message, null, 2)}</pre>
              </article>
            );
          })}
          {!messages.length && <p className="empty-state">No messages yet. Pull them after sending or hitting list.</p>}
        </div>
      </section>

      <section className="section-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Token Lab</p>
            <h2>Manage patient tokens</h2>
          </div>
          <div className="pill">Expires at (UTC)</div>
        </div>
        <div className="form-grid">
          <label>
            Expires at
            <input type="datetime-local" value={tokenExpiresAt} onChange={(event) => setTokenExpiresAt(event.target.value)} />
          </label>
        </div>
        <div className="action-row">
          <button type="button" onClick={createToken} className="primary">
            Create token
          </button>
          <button type="button" onClick={listTokens} className="ghost">
            List tokens
          </button>
        </div>
        <div className="list-grid">
          {tokens.map((token) => {
            const id = (token.id as string) ?? (token.token_id as string) ?? "unknown";
            const expires = (token.expires_at as string) ?? "—";
            const active = token.is_active ?? token.active ?? token.status;
            return (
              <article key={id} className="list-card">
                <p className="meta">ID: {id}</p>
                <p className="title">{expires}</p>
                <p className="meta">Active: {String(active)}</p>
                <div className="token-actions">
                  <button type="button" className="ghost" onClick={() => invalidateToken(id)}>
                    Invalidate
                  </button>
                  <span className="badge">{(token.token as string)?.slice(0, 16) ?? "token"}</span>
                </div>
              </article>
            );
          })}
          {!tokens.length && <p className="empty-state">No tokens returned yet.</p>}
        </div>
      </section>

      <section className="section-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Telemetry</p>
            <h2>Logs &amp; websocket</h2>
          </div>
        </div>
        <div className="log-grid">
          <div>
            <p className="meta">Status log</p>
            <ul>
              {statusLog.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="meta">Websocket feed</p>
            <ul>
              {wsFeed.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
