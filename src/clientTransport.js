import { io } from 'socket.io-client';

const socketUrl =
  import.meta.env?.VITE_SERVER_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001');

export const createRequest = (socketClient, timeoutMs = 8000) => (event, payload) =>
  new Promise((resolve, reject) => {
    if (!socketClient.connected) {
      reject(new Error('Not connected. Wait for the connection to recover and try again.'));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Server did not respond in time. Check your connection and try again.'));
    }, timeoutMs);

    socketClient.emit(event, payload, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!response?.ok) {
        reject(new Error(response?.message || 'Operation failed'));
        return;
      }
      resolve(response);
    });
  });

export const socket = io(socketUrl, { autoConnect: typeof window !== 'undefined' });
export const call = createRequest(socket);
