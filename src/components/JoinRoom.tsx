import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Video, Users } from 'lucide-react';

interface JoinRoomProps {
  onJoin: (userName: string, roomCode: string) => void;
}

export const JoinRoom = ({ onJoin }: JoinRoomProps) => {
  const [userName, setUserName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim() || !roomCode.trim()) return;
    
    setIsJoining(true);
    try {
      await onJoin(userName.trim(), roomCode.trim());
    } finally {
      setIsJoining(false);
    }
  };

  const generateRoomCode = () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomCode(code);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="relative">
              <Video className="h-12 w-12 text-primary" />
              <Users className="h-6 w-6 text-secondary-foreground absolute -bottom-1 -right-1 bg-background rounded-full p-1" />
            </div>
          </div>
          <CardTitle className="text-2xl">Entrar na Videochamada</CardTitle>
          <p className="text-muted-foreground">
            Digite seu nome e o código da sala para começar
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="userName">Seu Nome</Label>
              <Input
                id="userName"
                type="text"
                placeholder="Digite seu nome"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                required
                disabled={isJoining}
                className="w-full"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="roomCode">Código da Sala</Label>
              <div className="flex gap-2">
                <Input
                  id="roomCode"
                  type="text"
                  placeholder="Digite ou gere um código"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  required
                  disabled={isJoining}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={generateRoomCode}
                  disabled={isJoining}
                  className="whitespace-nowrap"
                >
                  Gerar
                </Button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isJoining || !userName.trim() || !roomCode.trim()}
            >
              {isJoining ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Entrando...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Video className="h-4 w-4" />
                  Entrar na Sala
                </div>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};