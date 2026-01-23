import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Video, VideoOff, Mic, MicOff, PhoneOff, Loader2, User } from 'lucide-react';

const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export default function App() {
  const [currentRoom, setCurrentRoom] = useState(null);
  const [isInCall, setIsInCall] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // NOVO: Estado para saber se já cliquei no botão e estou esperando
  const [isCalling, setIsCalling] = useState(false);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [remoteCamOn, setRemoteCamOn] = useState(true);
  const [remoteMicOn, setRemoteMicOn] = useState(true);

  // --- REFS ---
  const socket = useRef(null);
  const peerConnection = useRef(new RTCPeerConnection(rtcConfig));
  const userVideoRef = useRef();
  const partnerVideoRef = useRef();

  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const roomRef = useRef(null);

  useEffect(() => {
    roomRef.current = currentRoom;
  }, [currentRoom]);

  useEffect(() => {
    if (remoteCamOn && partnerVideoRef.current && remoteStreamRef.current) {
      partnerVideoRef.current.srcObject = remoteStreamRef.current;
      partnerVideoRef.current.play().catch(e => console.error("Erro autoplay:", e));
    }
  }, [remoteCamOn]);

  useEffect(() => {
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
      setIsCalling(false); // Reseta se cair
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
    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) sendSignal('candidate', event.candidate);
    };

    peerConnection.current.ontrack = (event) => {
      console.log("🎥 Vídeo remoto chegou!", event.streams[0]);
      remoteStreamRef.current = event.streams[0];
      if (partnerVideoRef.current) {
        partnerVideoRef.current.srcObject = event.streams[0];
        setIsInCall(true);
        setIsCalling(false); // Parar de mostrar "Aguardando..."
      }
    };

    peerConnection.current.oniceconnectionstatechange = () => {
      if (peerConnection.current.iceConnectionState === 'disconnected' || peerConnection.current.iceConnectionState === 'closed') {
        endCall(false);
      }
    }
  };

  const handleSocketMessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'full':
        alert(msg.message);
        setCurrentRoom(null);
        setIsCalling(false);
        break;

      case 'bye':
        alert("O outro usuário encerrou a chamada.");
        endCall(false);
        break;

      case 'media-update':
        if (msg.data.type === 'video') setRemoteCamOn(msg.data.enabled);
        if (msg.data.type === 'audio') setRemoteMicOn(msg.data.enabled);
        break;

      case 'offer':
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
          setIsCalling(false); // Remove loading

          sendSignal('media-update', { type: 'video', enabled: camOn });
          sendSignal('media-update', { type: 'audio', enabled: micOn });

        } catch (err) { console.error(err); }
        break;

      case 'answer':
        try {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(msg.data));
          setIsInCall(true);
          setIsCalling(false); // Remove loading

          sendSignal('media-update', { type: 'video', enabled: camOn });
          sendSignal('media-update', { type: 'audio', enabled: micOn });

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

  const sendSignal = (type, data) => {
    const roomToSend = roomRef.current || currentRoom;
    if (socket.current?.readyState === WebSocket.OPEN) {
      if (type !== 'join' && !roomToSend) return;
      const payload = { type, room: roomToSend, data };
      socket.current.send(JSON.stringify(payload));
    }
  };

  const joinRoom = (roomName) => {
    if (!isConnected) return alert("Conectando...");
    setCurrentRoom(roomName);
    roomRef.current = roomName;
    socket.current.send(JSON.stringify({ type: 'join', room: roomName }));
  };

  const startCall = async () => {
    if (!roomRef.current) return alert("Erro: Sala não identificada.");

    // ATIVA O MODO DE ESPERA VISUAL
    setIsCalling(true);

    try {
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      sendSignal('offer', offer);
    } catch (err) {
      console.error("Erro startCall:", err);
      setIsCalling(false); // Se der erro, volta o botão
    }
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        const newState = !audioTrack.enabled;
        audioTrack.enabled = newState;
        setMicOn(newState);
        sendSignal('media-update', { type: 'audio', enabled: newState });
      }
    }
  };

  const toggleCam = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        const newState = !videoTrack.enabled;
        videoTrack.enabled = newState;
        setCamOn(newState);
        sendSignal('media-update', { type: 'video', enabled: newState });
      }
    }
  };

  const endCall = (notifyServer = true) => {
    if (notifyServer) sendSignal('bye', null);
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 bg-zinc-950 text-white overflow-hidden flex flex-col">
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
        <div className="relative w-full h-full bg-black flex flex-col">
          <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-zinc-900">
            {remoteCamOn ? (
              <video ref={partnerVideoRef} autoPlay playsInline className="w-full h-full object-contain" />
            ) : (
              <div className="flex flex-col items-center justify-center text-zinc-500">
                <div className="w-32 h-32 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
                  <User size={64} />
                </div>
                <p className="text-lg font-medium">Câmera desligada</p>
              </div>
            )}

            {!remoteMicOn && isInCall && (
              <div className="absolute top-20 right-4 bg-red-500/20 text-red-400 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 backdrop-blur-md">
                <MicOff size={12} /> MUTADO
              </div>
            )}

            <div className="absolute top-4 left-4 z-20 bg-black/50 backdrop-blur px-4 py-2 rounded-full border border-white/10">
              <span className="text-sm font-bold text-zinc-300 uppercase tracking-wider">{currentRoom}</span>
            </div>

            {/* AQUI ESTÁ A MUDANÇA NA INTERFACE */}
            {!isInCall && (
              <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/60 backdrop-blur-sm">
                <div className="text-center p-6">
                  {isCalling ? (
                    /* ESTADO: AGUARDANDO */
                    <div className="animate-in fade-in zoom-in duration-300">
                      <div className="relative mx-auto mb-6 w-16 h-16">
                        <div className="absolute inset-0 rounded-full border-4 border-zinc-700"></div>
                        <div className="absolute inset-0 rounded-full border-4 border-t-blue-500 animate-spin"></div>
                      </div>
                      <h2 className="text-2xl font-bold text-white mb-2">Chamando...</h2>
                      <p className="text-zinc-400">Aguardando a outra pessoa atender.</p>
                      <p className="text-xs text-zinc-500 mt-4">Certifique-se que ela está na {currentRoom}</p>
                    </div>
                  ) : (
                    /* ESTADO: INICIAL (BOTÃO) */
                    <>
                      <p className="mb-6 text-xl text-zinc-200 font-medium">Você está na {currentRoom}</p>
                      <button onClick={startCall} className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-bold text-xl shadow-lg hover:scale-105 transition-transform flex items-center gap-3 mx-auto">
                        <Video size={24} /> Iniciar Chamada
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="absolute bottom-28 right-4 w-32 h-48 bg-zinc-900 rounded-xl overflow-hidden border border-white/20 shadow-xl z-20">
              <VideoLocal stream={localStreamRef.current} />
              {!camOn && <div className="absolute inset-0 flex items-center justify-center bg-zinc-800"><VideoOff className="text-zinc-500" /></div>}
              {!micOn && <div className="absolute top-2 right-2 bg-red-500 p-1 rounded-full"><MicOff size={12} className="text-white" /></div>}
            </div>
          </div>

          <div className="h-24 bg-zinc-900/90 backdrop-blur flex items-center justify-center gap-6 z-30 shrink-0 safe-pb">
            <button onClick={toggleMic} className={`p-4 rounded-full transition-colors ${micOn ? 'bg-zinc-800 text-white hover:bg-zinc-700' : 'bg-red-500/20 text-red-500 border border-red-500/50'}`}>
              {micOn ? <Mic /> : <MicOff />}
            </button>
            <button onClick={() => endCall(true)} className="p-4 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-lg transform hover:scale-105 transition-all">
              <PhoneOff />
            </button>
            <button onClick={toggleCam} className={`p-4 rounded-full transition-colors ${camOn ? 'bg-zinc-800 text-white hover:bg-zinc-700' : 'bg-red-500/20 text-red-500 border border-red-500/50'}`}>
              {camOn ? <Video /> : <VideoOff />}
            </button>
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