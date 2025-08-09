import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { JoinRoom } from '@/components/JoinRoom';
import { VideoCall } from '@/components/VideoCall';
import { useToast } from '@/components/ui/use-toast';

const Index = () => {
  const [currentRoom, setCurrentRoom] = useState<{
    roomCode: string;
    userName: string;
    roomId: string;
  } | null>(null);
  const { toast } = useToast();

  const handleJoinRoom = async (userName: string, roomCode: string) => {
    try {
      // Check if room exists, if not create it
      let { data: room } = await supabase
        .from('rooms')
        .select('*')
        .eq('room_code', roomCode)
        .maybeSingle();

      if (!room) {
        const { data: newRoom, error: createError } = await supabase
          .from('rooms')
          .insert({ room_code: roomCode })
          .select()
          .single();

        if (createError) throw createError;
        room = newRoom;
      }

      if (room) {
        setCurrentRoom({
          roomCode,
          userName,
          roomId: room.id
        });
        
        toast({
          title: "Entrando na sala",
          description: `Bem-vindo à sala ${roomCode}!`,
        });
      }
    } catch (error) {
      console.error('Error joining room:', error);
      toast({
        title: "Erro ao entrar na sala",
        description: "Não foi possível entrar na sala. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleLeaveRoom = () => {
    setCurrentRoom(null);
    toast({
      title: "Saiu da sala",
      description: "Você saiu da videochamada.",
    });
  };

  if (currentRoom) {
    return (
      <VideoCall
        roomId={currentRoom.roomId}
        roomCode={currentRoom.roomCode}
        userName={currentRoom.userName}
        onLeave={handleLeaveRoom}
      />
    );
  }

  return (
    <JoinRoom onJoin={handleJoinRoom} />
  );
};

export default Index;
