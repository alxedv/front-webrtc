import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Copy, Check, ArrowRight, Share2 } from 'lucide-react';
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// --- Utilitário para classes (Estilo Shadcn) ---
function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// --- Componentes de UI Reutilizáveis (Visual Profissional) ---
const Button = ({ className, variant = "primary", size = "default", ...props }) => {
  const variants = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)]",
    secondary: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700",
    danger: "bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20",
    ghost: "hover:bg-zinc-800 text-zinc-400 hover:text-white",
  };

  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      whileHover={{ scale: 1.02 }}
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        size === "icon" ? "h-12 w-12 rounded-full" : "h-12 px-6 py-2",
        className
      )}
      {...props}
    />
  );
};

const Input = ({ className, ...props }) => (
  <input
    className={cn(
      "flex h-12 w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50 transition-all",
      className
    )}
    {...props}
  />
);

// --- Configuração WebRTC ---
const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export default function App() {
  // Estados Lógicos
  const [myId, setMyId] = useState(null);
  const [targetId, setTargetId] = useState('');
  const [isInCall, setIsInCall] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Estados de Controle de Mídia
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  // Refs
  const userVideoRef = useRef();
  const partnerVideoRef = useRef();
  const peerConnection = useRef(new RTCPeerConnection(rtcConfig));
  const socket = useRef(null);
  const targetIdRef = useRef('');
  const localStreamRef = useRef(null);

  // --- Inicialização ---
  useEffect(() => {
    const init = async () => {
      // 1. Câmera
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: true
        });
        localStreamRef.current = stream;

        if (userVideoRef.current) userVideoRef.current.srcObject = stream;

        stream.getTracks().forEach(track => {
          peerConnection.current.addTrack(track, stream);
        });
      } catch (err) {
        console.error("Erro câmera:", err);
      }

      // 2. WebSocket
      const backendUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/socket';
      const ws = new WebSocket(backendUrl);
      socket.current = ws;

      ws.onmessage = handleSocketMessage;
    };

    init();
    setupWebRTCEvents();

    return () => {
      if (socket.current) socket.current.close();
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  // --- Lógica WebRTC (Idêntica à anterior, só limpei para brevidade) ---
  const setupWebRTCEvents = () => {
    peerConnection.current.onicecandidate = (e) => {
      if (e.candidate) sendSignal('candidate', e.candidate);
    };
    peerConnection.current.ontrack = (e) => {
      if (partnerVideoRef.current) {
        partnerVideoRef.current.srcObject = e.streams[0];
        setIsInCall(true);
      }
    };
  };

  const handleSocketMessage = async (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'id': setMyId(msg.id); break;
      case 'offer': await handleReceiveOffer(msg); break;
      case 'answer':
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(msg.data));
        setIsInCall(true);
        break;
      case 'candidate':
        if (msg.data) await peerConnection.current.addIceCandidate(msg.data);
        break;
    }
  };

  const sendSignal = (type, data) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({
        type, target: targetIdRef.current, source: myId, data
      }));
    }
  };

  const startCall = async () => {
    if (!targetId) return;
    targetIdRef.current = targetId;
    const offer = await peerConnection.current.createOffer();
    await peerConnection.current.setLocalDescription(offer);
    sendSignal('offer', offer);
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

  // --- Controles de Mídia ---
  const toggleMic = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      track.enabled = !track.enabled;
      setMicOn(track.enabled);
    }
  };

  const toggleCam = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getVideoTracks()[0];
      track.enabled = !track.enabled;
      setCamOn(track.enabled);
    }
  };

  const copyToClipboard = () => {
    if (myId) {
      navigator.clipboard.writeText(myId);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  // ================= RENDERIZAÇÃO =================
  return (
    <div className="relative h-screen w-screen bg-background text-white overflow-hidden flex flex-col">

      {/* 1. BACKGROUND ANIMADO (Bônus Visual) */}
      <div className="absolute inset-0 z-0 opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600 blur-[120px] animate-pulse-slow" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-600 blur-[120px] animate-pulse-slow delay-1000" />
      </div>

      {/* 2. STAGE DE VÍDEO PRINCIPAL */}
      <div className="flex-1 relative z-10 flex items-center justify-center">
        <video
          ref={partnerVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />

        {/* Placeholder enquanto conecta */}
        {!isInCall && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/50 backdrop-blur-sm z-0">
            <div className="w-24 h-24 rounded-full bg-zinc-800 flex items-center justify-center mb-4 animate-bounce">
              <span className="text-4xl">👋</span>
            </div>
            <p className="text-zinc-400">Aguardando vídeo remoto...</p>
          </div>
        )}

        {/* 3. PiP (Vídeo Local) */}
        <motion.div
          drag
          dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
          whileDrag={{ scale: 1.1, cursor: 'grabbing' }}
          className="absolute bottom-24 right-4 w-[28vw] max-w-[140px] aspect-[3/4] rounded-2xl overflow-hidden shadow-2xl border-2 border-white/10 bg-zinc-900 z-20 cursor-grab active:cursor-grabbing"
        >
          <video
            ref={userVideoRef}
            autoPlay
            playsInline
            muted
            className={cn("w-full h-full object-cover mirror-mode", !camOn && "opacity-0")}
            style={{ transform: 'scaleX(-1)' }} // Espelhar
          />
          {!camOn && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-800 text-zinc-500">
              <VideoOff size={24} />
            </div>
          )}
        </motion.div>
      </div>

      {/* 4. MODAL DE CONEXÃO (Lobby) */}
      <AnimatePresence>
        {!isInCall && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-background/60 backdrop-blur-md"
          >
            <div className="w-full max-w-md bg-surface/90 border border-white/10 p-6 rounded-3xl shadow-2xl backdrop-blur-xl">
              <div className="text-center mb-8">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Teste WebRTC
                </h1>
                <p className="text-zinc-400 text-sm mt-2">Vídeo chamadas P2P.</p>
              </div>

              {/* Box do ID */}
              <div className="space-y-4">
                <div className="group relative">
                  <label className="text-xs font-semibold text-zinc-500 ml-1 uppercase tracking-wider">Seu ID</label>
                  <div
                    onClick={copyToClipboard}
                    className="mt-1 flex items-center justify-between p-4 bg-black/40 border border-zinc-800 rounded-xl cursor-pointer hover:border-blue-500/50 transition-colors group-active:scale-[0.99]"
                  >
                    <code className="text-blue-400 font-mono text-lg truncate mr-2">
                      {myId || "Gerando..."}
                    </code>
                    {isCopied ? <Check size={18} className="text-green-500" /> : <Copy size={18} className="text-zinc-500 group-hover:text-white" />}
                  </div>
                </div>

                <div className="relative flex items-center justify-center py-2">
                  <div className="h-px bg-zinc-800 w-full"></div>
                  <span className="absolute bg-surface px-2 text-xs text-zinc-500">OU</span>
                </div>

                <div className="space-y-3">
                  <label className="text-xs font-semibold text-zinc-500 ml-1 uppercase tracking-wider">Conectar com amigo</label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Cole o ID aqui..."
                      value={targetId}
                      onChange={(e) => {
                        setTargetId(e.target.value);
                        targetIdRef.current = e.target.value;
                      }}
                    />
                    <Button
                      size="icon"
                      onClick={startCall}
                      disabled={!targetId}
                      className="shrink-0"
                    >
                      <ArrowRight size={20} />
                    </Button>
                  </div>
                </div>

                <Button
                  className="w-full mt-4 bg-white text-black hover:bg-zinc-200"
                  onClick={() => {
                    if (navigator.share) navigator.share({ title: 'Meu ID', text: myId });
                    else copyToClipboard();
                  }}
                >
                  <Share2 size={16} className="mr-2" /> Compartilhar meu ID
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 5. BARRA DE CONTROLES (Bottom Bar) */}
      <motion.div
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black to-transparent z-40 flex items-center justify-center gap-4 pb-6 px-4"
      >
        <Button
          variant="secondary"
          size="icon"
          onClick={toggleMic}
          className={cn(!micOn && "bg-red-500/20 text-red-500 border-red-500/50 hover:bg-red-500/30")}
        >
          {micOn ? <Mic size={20} /> : <MicOff size={20} />}
        </Button>

        <Button
          variant="secondary"
          size="icon"
          onClick={toggleCam}
          className={cn(!camOn && "bg-red-500/20 text-red-500 border-red-500/50 hover:bg-red-500/30")}
        >
          {camOn ? <Video size={20} /> : <VideoOff size={20} />}
        </Button>

        <Button
          variant="danger"
          size="icon"
          className="w-16 rounded-2xl" // Um pouco maior
          onClick={() => window.location.reload()}
        >
          <PhoneOff size={24} />
        </Button>
      </motion.div>

    </div>
  );
}