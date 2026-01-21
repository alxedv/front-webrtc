import { useEffect, useRef, useState } from 'react';
import './App.css'; // Importando o estilo bonito

// 1. CONFIGURAÇÃO STUN
// Servidores que ajudam a descobrir seu IP público (essencial para funcionar fora da rede local)
const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

function App() {
  // --- ESTADOS DA INTERFACE (O que o usuário vê) ---
  const [myId, setMyId] = useState('Conectando...');
  const [targetId, setTargetId] = useState('');
  const [isInCall, setIsInCall] = useState(false); // Controla se mostra o painel ou o vídeo
  const [localStream, setLocalStream] = useState(null);

  // --- REFERÊNCIAS MUTÁVEIS (O cérebro do WebRTC) ---
  // Usamos useRef para valores que precisam ser acessados instantaneamente dentro de callbacks
  // sem depender do ciclo de renderização do React.
  const userVideoRef = useRef();
  const partnerVideoRef = useRef();
  const peerConnection = useRef(new RTCPeerConnection(rtcConfig));
  const socket = useRef(null);
  const targetIdRef = useRef(''); // Guarda o ID do amigo para acesso imediato

  // ============================================================
  // FASE 1: INICIALIZAÇÃO (Câmera e WebSocket)
  // ============================================================
  useEffect(() => {
    // A. Ligar a Câmera
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);

        // Mostra meu rosto no vídeo pequeno
        if (userVideoRef.current) {
          userVideoRef.current.srcObject = stream;
        }

        // Adiciona meu vídeo/áudio na "Conexão P2P" (mesmo que ainda não conectada)
        stream.getTracks().forEach(track => {
          peerConnection.current.addTrack(track, stream);
        });
      } catch (error) {
        console.error("Erro ao acessar câmera:", error);
        alert("Precisamos da sua câmera para o app funcionar!");
      }
    };

    // B. Conectar no Servidor de Sinalização (Seu Java)
    const connectSocket = () => {
      // Dica: Usa o hostname atual para funcionar na rede local (ex: 192.168.x.x)
      const backendUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/socket';

      const ws = new WebSocket(backendUrl);
      socket.current = ws;

      ws.onopen = () => console.log("✅ WebSocket Conectado");

      // O "Carteiro" - Recebe mensagens do servidor
      ws.onmessage = handleSocketMessage;
    };

    startCamera();
    connectSocket();

    // C. Configurar Eventos do WebRTC (O que fazer quando a conexão muda)
    setupWebRTCEvents();

    // Cleanup: Desliga tudo se fechar a aba
    return () => {
      if (socket.current) socket.current.close();
    };
  }, []);


  // ============================================================
  // FASE 2: LÓGICA DE EVENTOS (Onde a mágica acontece)
  // ============================================================

  const setupWebRTCEvents = () => {
    // Evento 1: ICE Candidate (O WebRTC achou um caminho de rede/IP)
    // Temos que mandar esse "endereço" para o amigo via Socket
    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal('candidate', event.candidate);
      }
    };

    // Evento 2: Track (Chegou vídeo do amigo!)
    peerConnection.current.ontrack = (event) => {
      console.log("🎥 Vídeo remoto recebido!");
      if (partnerVideoRef.current) {
        partnerVideoRef.current.srcObject = event.streams[0];
        setIsInCall(true); // Esconde o painel e foca na chamada
      }
    };
  };

  const handleSocketMessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'id':
        // O servidor nos disse qual é o nosso ID
        setMyId(msg.id);
        break;

      case 'offer':
        // Alguém está me ligando!
        console.log("📩 Oferta recebida de:", msg.source);
        await handleReceiveOffer(msg);
        break;

      case 'answer':
        // O amigo atendeu minha ligação!
        console.log("📩 Resposta recebida");
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(msg.data));
        setIsInCall(true);
        break;

      case 'candidate':
        // Recebemos um novo endereço IP do amigo
        if (msg.data) {
          await peerConnection.current.addIceCandidate(msg.data);
        }
        break;

      default:
        break;
    }
  };

  // ============================================================
  // FASE 3: AÇÕES DO USUÁRIO (Ligar e Atender)
  // ============================================================

  // Função auxiliar para enviar mensagens JSON pro Java
  const sendSignal = (type, data) => {
    if (socket.current.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({
        type,
        target: targetIdRef.current, // Usa sempre o ID mais atual
        source: myId,
        data
      }));
    }
  };

  // QUEM LIGA (Caller)
  const startCall = async () => {
    if (!targetId) return alert("Digite o ID do amigo!");

    // Atualiza o ref para sabermos pra quem mandar mensagens futuras
    targetIdRef.current = targetId;

    try {
      // 1. Cria a Oferta (SDP)
      const offer = await peerConnection.current.createOffer();
      // 2. Define como "Descrição Local" (Eu sou assim)
      await peerConnection.current.setLocalDescription(offer);
      // 3. Envia pro servidor entregar pro amigo
      sendSignal('offer', offer);
      console.log("📤 Oferta enviada para:", targetId);
    } catch (error) {
      console.error("Erro ao criar oferta:", error);
    }
  };

  // QUEM RECEBE (Callee)
  const handleReceiveOffer = async (msg) => {
    // 1. Atualiza o alvo para quem nos ligou (pra responder pra pessoa certa)
    targetIdRef.current = msg.source;
    setTargetId(msg.source); // Atualiza visualmente o input

    // 2. Define a "Descrição Remota" (O amigo é assim)
    await peerConnection.current.setRemoteDescription(new RTCSessionDescription(msg.data));

    // 3. Cria a Resposta (Answer)
    const answer = await peerConnection.current.createAnswer();
    // 4. Define minha descrição local
    await peerConnection.current.setLocalDescription(answer);

    // 5. Envia a resposta de volta
    sendSignal('answer', answer);
    setIsInCall(true); // Entra na tela de vídeo
  };

  // ============================================================
  // FASE 4: INTERFACE (Renderização)
  // ============================================================
  return (
    <div className="meet-container">

      {/* --- PALCO PRINCIPAL DE VÍDEO --- */}
      <div className="video-stage">
        {/* Vídeo do Amigo (Grande) */}
        <video
          ref={partnerVideoRef}
          autoPlay
          playsInline
          className="remote-video"
        />

        {/* Se não estiver em chamada, mostra mensagem de espera */}
        {!isInCall && (
          <div style={{ position: 'absolute', color: '#555' }}>
            <h1>Aguardando conexão...</h1>
          </div>
        )}

        {/* Meu Vídeo (Picture in Picture) */}
        <div className="local-video-wrapper">
          <video
            ref={userVideoRef}
            autoPlay
            playsInline
            muted
            className="local-video"
          />
          <div className="user-label">Você</div>
        </div>
      </div>

      {/* --- PAINEL DE CONEXÃO (Aparece se não estiver em chamada) --- */}
      {!isInCall && (
        <div className="connection-panel">
          <h2 className="panel-title">Iniciar Reunião</h2>

          <div
            className="id-box"
            onClick={() => { navigator.clipboard.writeText(myId); alert('Copiado!') }}
            title="Clique para copiar"
          >
            Seu ID: <strong>{myId}</strong>
          </div>

          <div className="input-group">
            <input
              className="input-field"
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value);
                targetIdRef.current = e.target.value; // Importante: Atualiza o ref junto!
              }}
              placeholder="Cole o ID do amigo aqui"
            />
            <button className="connect-btn" onClick={startCall}>
              📞 Conectar Agora
            </button>
          </div>
        </div>
      )}

      {/* --- BARRA DE CONTROLES --- */}
      <div className="controls-bar">
        <button className="control-btn" title="Microfone">🎤</button>
        <button className="control-btn" title="Câmera">📷</button>
        <button
          className="control-btn end-call"
          title="Desligar"
          onClick={() => window.location.reload()}
        >
          ☎
        </button>
      </div>
    </div>
  );
}

export default App;