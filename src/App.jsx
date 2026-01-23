import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Video, VideoOff, Mic, MicOff, PhoneOff, Loader2 } from 'lucide-react';

const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export default function App() {
  const [currentRoom, setCurrentRoom] = useState(null);
  const [isInCall, setIsInCall] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  // --- REFS ---
  const socket = useRef(null);
  const peerConnection = useRef(new RTCPeerConnection(rtcConfig));
  const userVideoRef = useRef();
  const partnerVideoRef = useRef();
  const localStreamRef = useRef(null);

  // A CORREÇÃO MÁGICA: Um Ref para guardar a sala atual
  const roomRef = useRef(null);

  // --- 1. Sincroniza o Estado com o Ref ---
  // Sempre que currentRoom mudar, atualizamos o Ref.
  // Isso garante que os eventos do WebRTC vejam a sala correta.
  useEffect(() => {
    roomRef.current = currentRoom;
  }, [currentRoom]);

  useEffect(() => {
    // WebSocket Setup
    const backendUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/socket';
    const ws = new WebSocket(backendUrl);
    socket.current = ws;

    ws.onopen = () => {
      console.log("✅ Conectado ao Servidor");
      setIsConnected(true);
    };

    ws.onmessage = handleSocketMessage;

    ws.onclose = () => {
      console.log("❌ Socket desconectado");
      setIsConnected(false);
    };

    ws.onerror = (err) => {
      console.error("Erro no Socket:", err);
      setIsConnected(false);
    };

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;

        if (userVideoRef.current) userVideoRef.current.srcObject = stream;

        const senders = peerConnection.current.getSenders();
        stream.getTracks().forEach(track => {
          if (senders.find(s => s.track?.kind === track.kind)) return;
          peerConnection.current.addTrack(track, stream);
        });
      } catch (err) {
        console.error("Erro Câmera:", err);
        setErrorMsg("Erro na câmera.");
      }
    };

    startCamera();
    setupWebRTCEvents();

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, []);

  const setupWebRTCEvents = () => {
    // AGORA FUNCIONA: O evento lê roomRef.current, que está atualizado
    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) sendSignal('candidate', event.candidate);
    };

    peerConnection.current.ontrack = (event) => {
      console.log("🎥 Vídeo remoto chegou!", event.streams[0]);
      if (partnerVideoRef.current) {
        partnerVideoRef.current.srcObject = event.streams[0];
        setIsInCall(true);
      }
    };
  };

  const handleSocketMessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'full':
        alert(msg.message);
        setCurrentRoom(null);
        break;

      case 'offer':
        console.log("📩 Oferta recebida...");
        try {
          if (peerConnection.current.signalingState !== "stable") {
            await Promise.all([
              peerConnection.current.setLocalDescription({ type: "rollback" }),
              peerConnection.current.setRemoteDescription(new RTCSessionDescription(msg.data))
            ]);
          } else {
            await peerConnection.current.setRemoteDescription(new RTCSessionDescription(msg.data));
          }

          const answer = await peerConnection.current.createAnswer();
          await peerConnection.current.setLocalDescription(answer);
          sendSignal('answer', answer);
          setIsInCall(true);
        } catch (err) { console.error(err); }
        break;

      case 'answer':
        console.log("📩 Resposta recebida!");
        try {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(msg.data));
          setIsInCall(true);
        } catch (err) { console.error(err); }
        break;

      case 'candidate':
        if (msg.data) {
          try { await peerConnection.current.addIceCandidate(msg.data); }
          catch (err) { console.error("Erro ICE:", err); }
        }
        break;
      default: break;
    }
  };

  // --- ENVIO CORRIGIDO ---
  const sendSignal = (type, data) => {
    // PRIORIDADE: Lê do Ref (sempre atual), depois do State, depois do argumento
    const roomToSend = roomRef.current || currentRoom;

    if (socket.current?.readyState === WebSocket.OPEN) {
      // Se ainda assim for null, e não for join, aí sim é erro
      if (type !== 'join' && !roomToSend) {
        console.error(`⚠️ Tentando enviar ${type} sem sala!`);
        return;
      }

      const payload = { type, room: roomToSend, data };
      socket.current.send(JSON.stringify(payload));
    } else {
      console.error("❌ Socket fechado. Não enviou:", type);
    }
  };

  const joinRoom = (roomName) => {
    if (!isConnected) return alert("Conectando...");

    // Atualiza State E Ref manualmente para garantir rapidez
    setCurrentRoom(roomName);
    roomRef.current = roomName;

    socket.current.send(JSON.stringify({ type: 'join', room: roomName }));
  };

  const startCall = async () => {
    // Usa o Ref para garantir
    if (!roomRef.current) return alert("Erro: Sala não identificada.");
    console.log("📞 Iniciando chamada na sala:", roomRef.current);

    try {
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      sendSignal('offer', offer);
    } catch (err) {
      console.error("Erro startCall:", err);
    }
  };

  return (
    <div className="h-screen w-screen bg-zinc-950 text-white overflow-hidden flex flex-col">
      {!currentRoom ? (
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <div className="max-w-md w-full space-y-6 text-center">
            <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">WebRTC Salas</h1>
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${isConnected ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
              {isConnected ? '🟢 Servidor Online' : '🟡 Conectando...'}
            </div>
            {errorMsg && <div className="text-red-400 text-sm">{errorMsg}</div>}
            <div className="space-y-4 pt-4">
              <button onClick={() => joinRoom('sala-01')} disabled={!isConnected} className="w-full p-6 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-blue-500 transition-all flex items-center justify-between group disabled:opacity-50">
                <span className="font-semibold text-lg">🏠 Sala 01</span>
                {!isConnected ? <Loader2 className="animate-spin" /> : <ArrowRight className="text-zinc-600 group-hover:text-blue-500" />}
              </button>
              <button onClick={() => joinRoom('sala-02')} disabled={!isConnected} className="w-full p-6 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-purple-500 transition-all flex items-center justify-between group disabled:opacity-50">
                <span className="font-semibold text-lg">🚀 Sala 02</span>
                {!isConnected ? <Loader2 className="animate-spin" /> : <ArrowRight className="text-zinc-600 group-hover:text-purple-500" />}
              </button>
            </div>
            <div className="mt-8 flex justify-center"><div className="w-32 h-24 bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800"><video ref={userVideoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" /></div></div>
          </div>
        </div>
      ) : (
        <div className="flex-1 relative bg-black flex items-center justify-center">
          <video ref={partnerVideoRef} autoPlay playsInline className="w-full h-full object-contain" />
          <div className="absolute top-4 left-4 z-20 bg-black/50 backdrop-blur px-4 py-2 rounded-full border border-white/10">
            <span className="text-sm font-bold text-zinc-300 uppercase tracking-wider">{currentRoom}</span>
          </div>
          {!isInCall && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/60 backdrop-blur-sm">
              <div className="text-center p-6">
                <p className="mb-6 text-xl text-zinc-200 font-medium">Você está na {currentRoom}</p>
                <button onClick={startCall} className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-bold text-xl shadow-lg hover:scale-105 transition-transform flex items-center gap-3 mx-auto">
                  <Video size={24} /> Iniciar Chamada
                </button>
                <p className="mt-4 text-sm text-zinc-400">Certifique-se que o outro usuário também entrou nesta sala.</p>
              </div>
            </div>
          )}
          <div className="absolute bottom-24 right-4 w-32 h-48 bg-zinc-900 rounded-xl overflow-hidden border border-white/20 shadow-xl z-20">
            <VideoLocal stream={localStreamRef.current} />
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black to-transparent flex items-center justify-center gap-6 z-30 pb-6">
            <button onClick={() => setMicOn(!micOn)} className={`p-4 rounded-full transition-colors ${micOn ? 'bg-zinc-800 text-white' : 'bg-red-500/20 text-red-500 border border-red-500/50'}`}>{micOn ? <Mic /> : <MicOff />}</button>
            <button onClick={() => window.location.reload()} className="p-4 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-lg"><PhoneOff /></button>
            <button onClick={() => setCamOn(!camOn)} className={`p-4 rounded-full transition-colors ${camOn ? 'bg-zinc-800 text-white' : 'bg-red-500/20 text-red-500 border border-red-500/50'}`}>{camOn ? <Video /> : <VideoOff />}</button>
          </div>
        </div>
      )}
    </div>
  );
}

const VideoLocal = ({ stream }) => {
  const videoRef = useRef();
  useEffect(() => { if (videoRef.current && stream) videoRef.current.srcObject = stream; }, [stream]);
  return <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />;
};