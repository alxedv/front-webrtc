import { useEffect, useRef, useState } from 'react';
import './App.css';

// Configuração STUN (Padrão)
const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

function App() {
  const [myId, setMyId] = useState('...');
  const [targetId, setTargetId] = useState('');
  const [isInCall, setIsInCall] = useState(false);
  const [localStream, setLocalStream] = useState(null);

  const userVideoRef = useRef();
  const partnerVideoRef = useRef();
  const peerConnection = useRef(new RTCPeerConnection(rtcConfig));
  const socket = useRef(null);
  const targetIdRef = useRef('');

  useEffect(() => {
    const startCamera = async () => {
      try {
        // Pedimos vídeo virado para o usuário (selfie) preferencialmente
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: true
        });
        setLocalStream(stream);

        if (userVideoRef.current) {
          userVideoRef.current.srcObject = stream;
        }

        stream.getTracks().forEach(track => {
          peerConnection.current.addTrack(track, stream);
        });
      } catch (error) {
        console.error("Erro Câmera:", error);
        alert("Ative a câmera para continuar.");
      }
    };

    const connectSocket = () => {
      const backendUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/socket';
      const ws = new WebSocket(backendUrl);
      socket.current = ws;

      ws.onopen = () => console.log("✅ WebSocket On");
      ws.onmessage = handleSocketMessage;
    };

    startCamera();
    connectSocket();
    setupWebRTCEvents();

    return () => {
      if (socket.current) socket.current.close();
    };
  }, []);

  const setupWebRTCEvents = () => {
    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) sendSignal('candidate', event.candidate);
    };

    peerConnection.current.ontrack = (event) => {
      if (partnerVideoRef.current) {
        partnerVideoRef.current.srcObject = event.streams[0];
        setIsInCall(true);
      }
    };
  };

  const handleSocketMessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'id':
        setMyId(msg.id);
        break;
      case 'offer':
        await handleReceiveOffer(msg);
        break;
      case 'answer':
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(msg.data));
        setIsInCall(true);
        break;
      case 'candidate':
        if (msg.data) await peerConnection.current.addIceCandidate(msg.data);
        break;
      default: break;
    }
  };

  const sendSignal = (type, data) => {
    if (socket.current.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({
        type,
        target: targetIdRef.current,
        source: myId,
        data
      }));
    }
  };

  const startCall = async () => {
    if (!targetId) return alert("Cole o ID do amigo primeiro!");
    targetIdRef.current = targetId;

    try {
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      sendSignal('offer', offer);
    } catch (error) {
      console.error("Erro oferta:", error);
    }
  };

  const handleReceiveOffer = async (msg) => {
    targetIdRef.current = msg.source;
    setTargetId(msg.source);
    await peerConnection.current.setRemoteDescription(new RTCSessionDescription(msg.data));
    const answer = await peerConnection.current.createAnswer();
    await peerConnection.current.setLocalDescription(answer);
    sendSignal('answer', answer);
    setIsInCall(true);
  };

  return (
    <div className="meet-container">
      {/* Vídeo Principal (Ocupa toda a tela) */}
      <div className="video-stage">
        <video
          ref={partnerVideoRef}
          autoPlay
          playsInline /* Essencial para iOS não abrir em fullscreen nativo */
          className="remote-video"
        />

        {/* Modal de Conexão */}
        {!isInCall && (
          <div className="connection-panel">
            <h2 className="panel-title">Video Call P2P</h2>
            <p style={{ fontSize: '0.9rem', color: '#aaa', marginBottom: '15px' }}>Compartilhe seu ID para conectar</p>

            <div
              className="id-box"
              onClick={() => { navigator.clipboard.writeText(myId); alert('ID Copiado!') }}
            >
              {myId.includes('-') ? myId.split('-')[0] + '...' : myId}
              <div style={{ fontSize: '0.7rem', marginTop: 5 }}>Toque para copiar</div>
            </div>

            <div className="input-group">
              <input
                className="input-field"
                value={targetId}
                onChange={(e) => {
                  setTargetId(e.target.value);
                  targetIdRef.current = e.target.value;
                }}
                placeholder="Cole o ID do amigo"
                inputMode="text"
              />
              <button className="connect-btn" onClick={startCall}>
                Chamar Agora
              </button>
            </div>
          </div>
        )}

        {/* PiP: Meu Vídeo (Fica flutuando) */}
        <div className="local-video-wrapper">
          <video
            ref={userVideoRef}
            autoPlay
            playsInline
            muted
            className="local-video"
          />
        </div>
      </div>

      {/* Controles Flutuantes */}
      <div className="controls-bar">
        <button className="control-btn">🎙️</button>
        <button className="control-btn">📹</button>
        <button
          className="control-btn end-call"
          onClick={() => window.location.reload()}
        >
          📞
        </button>
      </div>
    </div>
  );
}

export default App;