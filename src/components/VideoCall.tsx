import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useToast } from '@/components/ui/use-toast';
import { PhoneOff, Mic, MicOff, Video, VideoOff, Users, Copy } from 'lucide-react';
import { useState } from 'react';

interface VideoCallProps {
  roomId: string;
  roomCode: string;
  userName: string;
  onLeave: () => void;
}

export const VideoCall = ({ roomId, roomCode, userName, onLeave }: VideoCallProps) => {
  const { toast } = useToast();
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  
  // Generate a stable unique peer ID for this session
  const peerId = useRef<string>();
  if (!peerId.current) {
    peerId.current = `${userName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  const {
    participants,
    isConnected,
    localStream,
    remoteStreams,
    localVideoRef,
    joinRoom,
    leaveRoom
  } = useWebRTC(roomId, userName, peerId.current);

  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  useEffect(() => {
    joinRoom().catch((error) => {
      toast({
        title: "Erro ao entrar na sala",
        description: error.message || "Não foi possível acessar câmera/microfone",
        variant: "destructive",
      });
    });

    return () => {
      leaveRoom();
    };
  }, []); // Remove dependências para evitar loop

  // Assign stream to video element when available
  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Assign stream when video element becomes available
  useEffect(() => {
    if (isConnected && localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [isConnected, localStream]);

  // Update remote video elements when streams change
  useEffect(() => {
    remoteStreams.forEach((stream, participantPeerId) => {
      const videoElement = remoteVideoRefs.current.get(participantPeerId);
      if (videoElement) {
        videoElement.srcObject = stream;
      }
    });
  }, [remoteStreams]);

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const handleLeave = async () => {
    await leaveRoom();
    onLeave();
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomCode);
    toast({
      title: "Código copiado!",
      description: "O código da sala foi copiado para a área de transferência",
    });
  };

  const setRemoteVideoRef = (participantPeerId: string) => (el: HTMLVideoElement | null) => {
    if (el) {
      remoteVideoRefs.current.set(participantPeerId, el);
      const stream = remoteStreams.get(participantPeerId);
      if (stream) {
        el.srcObject = stream;
      }
    } else {
      remoteVideoRefs.current.delete(participantPeerId);
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold">Conectando à sala...</h2>
          <p className="text-muted-foreground">Aguarde enquanto configuramos sua videochamada</p>
        </div>
      </div>
    );
  }

  const totalParticipants = participants.length + 1; // +1 for current user
  const remoteParticipants = Array.from(remoteStreams.keys());

  return (
    <div className="min-h-screen bg-background p-4">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-sm">
            <Users className="h-3 w-3 mr-1" />
            {totalParticipants} participante{totalParticipants !== 1 ? 's' : ''}
          </Badge>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={copyRoomCode}
            className="flex items-center gap-2"
          >
            <Copy className="h-3 w-3" />
            Sala: {roomCode}
          </Button>
        </div>
        
        <h1 className="text-lg font-semibold">Videochamada - {userName}</h1>
      </div>

      {/* Video Grid */}
      <div className={`grid gap-4 mb-6 ${
        totalParticipants === 1 ? 'grid-cols-1' : 
        totalParticipants === 2 ? 'grid-cols-2' : 
        totalParticipants <= 4 ? 'grid-cols-2' : 
        'grid-cols-3'
      }`}>
        {/* Local Video */}
        <Card className="relative overflow-hidden aspect-video">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
          <div className="absolute bottom-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-sm">
            Você
          </div>
          {isVideoOff && (
            <div className="absolute inset-0 bg-muted flex items-center justify-center">
              <div className="text-center">
                <VideoOff className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Câmera desligada</p>
              </div>
            </div>
          )}
        </Card>

        {/* Remote Videos */}
        {remoteParticipants.map((participantPeerId) => {
          const participant = participants.find(p => p.peer_id === participantPeerId);
          return (
            <Card key={participantPeerId} className="relative overflow-hidden aspect-video">
              <video
                ref={setRemoteVideoRef(participantPeerId)}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-sm">
                {participant?.user_name || 'Participante'}
              </div>
            </Card>
          );
        })}

        {/* Empty slots for grid layout */}
        {totalParticipants < 4 && Array.from({ length: 4 - totalParticipants }, (_, i) => (
          <Card key={`empty-${i}`} className="aspect-video bg-muted/50 border-dashed flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2" />
              <p className="text-sm">Aguardando participante</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Controls */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-card border rounded-full p-3 shadow-lg">
        <Button
          variant={isMuted ? "destructive" : "secondary"}
          size="lg"
          onClick={toggleMute}
          className="rounded-full w-12 h-12 p-0"
        >
          {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </Button>
        
        <Button
          variant={isVideoOff ? "destructive" : "secondary"}
          size="lg"
          onClick={toggleVideo}
          className="rounded-full w-12 h-12 p-0"
        >
          {isVideoOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
        </Button>
        
        <Button
          variant="destructive"
          size="lg"
          onClick={handleLeave}
          className="rounded-full w-12 h-12 p-0"
        >
          <PhoneOff className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
};