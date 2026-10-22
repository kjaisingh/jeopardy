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
    let timer;
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socketClient.off('disconnect', onDisconnect);
      if (error) reject(error);
      else resolve(response);
    };
    const onDisconnect = () => finish(new Error('Connection lost. Wait for your game to reconnect before trying again.'));
    socketClient.once('disconnect', onDisconnect);
    timer = setTimeout(() => finish(new Error('Server did not respond in time. Check your connection and try again.')), timeoutMs);

    socketClient.emit(event, payload, (response) => {
      if (!response?.ok) {
        finish(new Error(response?.message || 'Operation failed'));
        return;
      }
      finish(null, response);
    });
  });

export const socket = io(socketUrl, { autoConnect: typeof window !== 'undefined' });
export const call = createRequest(socket);
