import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Participant {
  id: string;
  user_name: string;
  peer_id: string;
  is_active: boolean;
}

interface SignalData {
  type: RTCSdpType | string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

export const useWebRTC = (roomId: string, userName: string, peerId: string) => {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidate[]>>(new Map());

  // Refs para controlar canais e evitar resubscribe em loop
  const participantsChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const signalingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const subscribedKeyRef = useRef<string | null>(null);

  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
    // TURN server temporariamente desabilitado para evitar erro de autenticação
    // {
    //   urls: 'turn:168.138.132.175:3478',
    //   username: 'user',
    //   credential: '505e68ee1b35c83a2ef5dec77d5d8631'
    // }
  ];

  // Initialize local media
  const initializeMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
      });
      
      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (error) {
      console.error('[useWebRTC] Error accessing media devices:', error);
      throw error;
    }
  }, []);

  // Create peer connection
  const createPeerConnection = useCallback((targetPeerId: string, stream: MediaStream) => {
    const pc = new RTCPeerConnection({ iceServers });

    // Add local stream tracks
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    // Handle remote stream
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      setRemoteStreams(prev => new Map(prev.set(targetPeerId, remoteStream)));
    };

    // Handle ICE candidates
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        await supabase
          .from('signaling')
          .insert({
            room_id: roomId,
            from_peer_id: peerId,
            to_peer_id: targetPeerId,
            signal_type: 'ice-candidate',
            signal_data: { 
              candidate: {
                candidate: event.candidate.candidate,
                sdpMLineIndex: event.candidate.sdpMLineIndex,
                sdpMid: event.candidate.sdpMid,
                usernameFragment: event.candidate.usernameFragment
              }
            }
          });
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        console.log(`Connected to peer: ${targetPeerId}`);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        console.log(`Disconnected from peer: ${targetPeerId}`);
        setRemoteStreams(prev => {
          const newMap = new Map(prev);
          newMap.delete(targetPeerId);
          return newMap;
        });
      }
    };

    peerConnectionsRef.current.set(targetPeerId, pc);
    return pc;
  }, [roomId, peerId]); // Removida dependência iceServers

  // Join room
  const joinRoom = useCallback(async () => {
    try {
      const stream = await initializeMedia();
      
      // Add participant to room
      await supabase
        .from('participants')
        .insert({
          room_id: roomId,
          user_name: userName,
          peer_id: peerId,
          is_active: true
        });

      setIsConnected(true);

      // Get existing participants and create offers to them
      const { data: existingParticipants } = await supabase
        .from('participants')
        .select('*')
        .eq('room_id', roomId)
        .eq('is_active', true)
        .neq('peer_id', peerId);

      if (existingParticipants) {
        for (const participant of existingParticipants) {
          const pc = createPeerConnection(participant.peer_id, stream);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          await supabase
            .from('signaling')
            .insert({
              room_id: roomId,
              from_peer_id: peerId,
              to_peer_id: participant.peer_id,
              signal_type: 'offer',
              signal_data: { type: 'offer', sdp: offer.sdp }
            });
        }
      }
    } catch (error) {
      console.error('Error joining room:', error);
      throw error;
    }
  }, [roomId, userName, peerId]); // Apenas dependências essenciais

  // Leave room
  const leaveRoom = useCallback(async () => {
    // Close all peer connections
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();

    // Stop local stream
    const currentStream = localStreamRef.current;
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
    }
    localStreamRef.current = null;

    // Remove from participants
    await supabase
      .from('participants')
      .delete()
      .eq('room_id', roomId)
      .eq('peer_id', peerId);

    // Remover canais explicitamente ao sair
    if (participantsChannelRef.current) {
      supabase.removeChannel(participantsChannelRef.current);
      participantsChannelRef.current = null;
    }
    if (signalingChannelRef.current) {
      supabase.removeChannel(signalingChannelRef.current);
      signalingChannelRef.current = null;
    }
    subscribedKeyRef.current = null;

    setIsConnected(false);
    setLocalStream(null);
    setRemoteStreams(new Map());
  }, [roomId, peerId]); // Removida dependência localStream

  // Set up realtime subscriptions
  useEffect(() => {
    if (!isConnected) return;

    const currentKey = `${roomId}:${peerId}`;
    if (subscribedKeyRef.current === currentKey && participantsChannelRef.current && signalingChannelRef.current) {
      console.log('[useWebRTC] Already subscribed for key:', currentKey);
      return;
    }

    // Se existir uma subscrição anterior de outra sala/peer, remover primeiro
    if (subscribedKeyRef.current && subscribedKeyRef.current !== currentKey) {
      console.log('[useWebRTC] Cleaning previous subscription for key:', subscribedKeyRef.current);
      if (participantsChannelRef.current) supabase.removeChannel(participantsChannelRef.current);
      if (signalingChannelRef.current) supabase.removeChannel(signalingChannelRef.current);
      participantsChannelRef.current = null;
      signalingChannelRef.current = null;
      subscribedKeyRef.current = null;
    }

    console.log('[useWebRTC] Subscribing to channels for room:', roomId, 'peer:', peerId);

    // Create stable peer connection function inside effect
    const createStablePeerConnection = (targetPeerId: string, stream: MediaStream) => {
      const pc = new RTCPeerConnection({ iceServers });

      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        setRemoteStreams(prev => new Map(prev.set(targetPeerId, remoteStream)));
      };

      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          await supabase
            .from('signaling')
            .insert({
              room_id: roomId,
              from_peer_id: peerId,
              to_peer_id: targetPeerId,
              signal_type: 'ice-candidate',
              signal_data: { 
                candidate: {
                  candidate: event.candidate.candidate,
                  sdpMLineIndex: event.candidate.sdpMLineIndex,
                  sdpMid: event.candidate.sdpMid,
                  usernameFragment: event.candidate.usernameFragment
                }
              }
            });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          console.log(`Connected to peer: ${targetPeerId}`);
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          console.log(`Disconnected from peer: ${targetPeerId}`);
          setRemoteStreams(prev => {
            const newMap = new Map(prev);
            newMap.delete(targetPeerId);
            return newMap;
          });
        }
      };

      peerConnectionsRef.current.set(targetPeerId, pc);
      return pc;
    };

    // Listen for new participants
    const participantsChannel = supabase
      .channel('participants')
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` },
        async (payload) => {
          console.log('[useWebRTC] INSERT participant payload:', payload);
          const newParticipant = payload.new as Participant;
          if (newParticipant.peer_id !== peerId) {
            setParticipants(prev => [...prev, newParticipant]);
          }
        }
      )
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` },
        (payload) => {
          console.log('[useWebRTC] DELETE participant payload:', payload);
          const deletedParticipant = payload.old as Participant;
          setParticipants(prev => prev.filter(p => p.peer_id !== deletedParticipant.peer_id));
          
          // Close peer connection
          const pc = peerConnectionsRef.current.get(deletedParticipant.peer_id);
          if (pc) {
            pc.close();
            peerConnectionsRef.current.delete(deletedParticipant.peer_id);
          }
          setRemoteStreams(prev => {
            const newMap = new Map(prev);
            newMap.delete(deletedParticipant.peer_id);
            return newMap;
          });
        }
      );

    const signalingChannel = supabase
      .channel('signaling')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'signaling', filter: `room_id=eq.${roomId}` },
        async (payload) => {
          console.log('[useWebRTC] INSERT signaling payload:', payload);
          const signal = payload.new as any;
          if (signal.to_peer_id === peerId || !signal.to_peer_id) {
            const { from_peer_id, signal_type, signal_data } = signal;
            switch (signal_type) {
              case 'offer': {
                const currentStream = localStreamRef.current;
                if (!currentStream) {
                  console.error('[useWebRTC] No local stream available for offer handling');
                  return;
                }
                const pc = createStablePeerConnection(from_peer_id, currentStream);
                await pc.setRemoteDescription(new RTCSessionDescription({
                  type: signal_data.type as RTCSdpType,
                  sdp: signal_data.sdp
                }));
                
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);

                await supabase
                  .from('signaling')
                  .insert({
                    room_id: roomId,
                    from_peer_id: peerId,
                    to_peer_id: from_peer_id,
                    signal_type: 'answer',
                    signal_data: { type: 'answer', sdp: answer.sdp }
                  });

                // Process any pending candidates
                const pendingCandidates = pendingCandidatesRef.current.get(from_peer_id) || [];
                for (const candidate of pendingCandidates) {
                  await pc.addIceCandidate(candidate);
                }
                pendingCandidatesRef.current.delete(from_peer_id);
                break;
              }
              case 'answer': {
                const pc = peerConnectionsRef.current.get(from_peer_id);
                if (pc) {
                  await pc.setRemoteDescription(new RTCSessionDescription({
                    type: signal_data.type as RTCSdpType,
                    sdp: signal_data.sdp
                  }));
                  
                  // Process any pending candidates
                  const pendingCandidates = pendingCandidatesRef.current.get(from_peer_id) || [];
                  for (const candidate of pendingCandidates) {
                    await pc.addIceCandidate(candidate);
                  }
                  pendingCandidatesRef.current.delete(from_peer_id);
                }
                break;
              }
              case 'ice-candidate': {
                const pc = peerConnectionsRef.current.get(from_peer_id);
                if (pc && pc.remoteDescription && signal_data.candidate) {
                  await pc.addIceCandidate(new RTCIceCandidate(signal_data.candidate));
                } else if (signal_data.candidate) {
                  // Store candidates for later if remote description isn't set yet
                  const pending = pendingCandidatesRef.current.get(from_peer_id) || [];
                  pending.push(new RTCIceCandidate(signal_data.candidate));
                  pendingCandidatesRef.current.set(from_peer_id, pending);
                }
                break;
              }
              default: {
                console.warn('[useWebRTC] Unknown signal type:', signal_type);
              }
            }
          }
        }
      );

    participantsChannelRef.current = participantsChannel;
    signalingChannelRef.current = signalingChannel;
    subscribedKeyRef.current = currentKey;

    // Assinar os canais (status logs para debug)
    participantsChannel.subscribe((status) => {
      console.log('[useWebRTC] participants channel status:', status);
      if (participantsChannel.state === 'closed') {
        console.error('[useWebRTC] Canal de participantes fechado. Verifique a conexão WebSocket do Supabase Realtime.');
      }
    });
    signalingChannel.subscribe((status) => {
      console.log('[useWebRTC] signaling channel status:', status);
      if (signalingChannel.state === 'closed') {
        console.error('[useWebRTC] Canal de signaling fechado. Verifique a conexão WebSocket do Supabase Realtime.');
      }
    });

    // Buscar participantes iniciais de forma assíncrona
    (async () => {
      const { data: initialParticipants, error: initialErr } = await supabase
        .from('participants')
        .select('*')
        .eq('room_id', roomId)
        .eq('is_active', true);
      if (initialErr) {
        console.error('[useWebRTC] Error fetching initial participants:', initialErr);
      } else if (initialParticipants) {
        setParticipants(initialParticipants);
      }
    })();

    // Cleanup ao desmontar ou trocar dependências
    return () => {
      console.log('[useWebRTC] Cleanup - removing channels for room:', roomId, 'peer:', peerId);
      if (participantsChannelRef.current) {
        supabase.removeChannel(participantsChannelRef.current);
        participantsChannelRef.current = null;
      }
      if (signalingChannelRef.current) {
        supabase.removeChannel(signalingChannelRef.current);
        signalingChannelRef.current = null;
      }
      subscribedKeyRef.current = null;
    };
  }, [isConnected, roomId, peerId]); // Removida dependência localStream

  return {
    participants,
    isConnected,
    localStream,
    remoteStreams,
    localVideoRef,
    joinRoom,
    leaveRoom
  };
};