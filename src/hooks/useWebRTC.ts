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
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidate[]>>(new Map());

  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  // Initialize local media
  const initializeMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
      });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
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
  }, [roomId, peerId]);

  // Send offer to peer
  const sendOffer = useCallback(async (targetPeerId: string, stream: MediaStream) => {
    const pc = createPeerConnection(targetPeerId, stream);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await supabase
      .from('signaling')
      .insert({
        room_id: roomId,
        from_peer_id: peerId,
        to_peer_id: targetPeerId,
        signal_type: 'offer',
        signal_data: { type: 'offer', sdp: offer.sdp }
      });
  }, [createPeerConnection, roomId, peerId]);

  // Handle incoming offer
  const handleOffer = useCallback(async (fromPeerId: string, signalData: SignalData, stream: MediaStream) => {
    const pc = createPeerConnection(fromPeerId, stream);
    await pc.setRemoteDescription(new RTCSessionDescription({
      type: signalData.type as RTCSdpType,
      sdp: signalData.sdp
    }));
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await supabase
      .from('signaling')
      .insert({
        room_id: roomId,
        from_peer_id: peerId,
        to_peer_id: fromPeerId,
        signal_type: 'answer',
        signal_data: { type: 'answer', sdp: answer.sdp }
      });

    // Process any pending candidates
    const pendingCandidates = pendingCandidatesRef.current.get(fromPeerId) || [];
    for (const candidate of pendingCandidates) {
      await pc.addIceCandidate(candidate);
    }
    pendingCandidatesRef.current.delete(fromPeerId);
  }, [createPeerConnection, roomId, peerId]);

  // Handle incoming answer
  const handleAnswer = useCallback(async (fromPeerId: string, signalData: SignalData) => {
    const pc = peerConnectionsRef.current.get(fromPeerId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription({
        type: signalData.type as RTCSdpType,
        sdp: signalData.sdp
      }));
      
      // Process any pending candidates
      const pendingCandidates = pendingCandidatesRef.current.get(fromPeerId) || [];
      for (const candidate of pendingCandidates) {
        await pc.addIceCandidate(candidate);
      }
      pendingCandidatesRef.current.delete(fromPeerId);
    }
  }, []);

  // Handle ICE candidate
  const handleIceCandidate = useCallback(async (fromPeerId: string, signalData: SignalData) => {
    const pc = peerConnectionsRef.current.get(fromPeerId);
    if (pc && pc.remoteDescription && signalData.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
    } else if (signalData.candidate) {
      // Store candidates for later if remote description isn't set yet
      const pending = pendingCandidatesRef.current.get(fromPeerId) || [];
      pending.push(new RTCIceCandidate(signalData.candidate));
      pendingCandidatesRef.current.set(fromPeerId, pending);
    }
  }, []);

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
          await sendOffer(participant.peer_id, stream);
        }
      }
    } catch (error) {
      console.error('Error joining room:', error);
      throw error;
    }
  }, [roomId, userName, peerId, initializeMedia, sendOffer]);

  // Leave room
  const leaveRoom = useCallback(async () => {
    // Close all peer connections
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();

    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    // Remove from participants
    await supabase
      .from('participants')
      .delete()
      .eq('room_id', roomId)
      .eq('peer_id', peerId);

    setIsConnected(false);
    setLocalStream(null);
    setRemoteStreams(new Map());
  }, [roomId, peerId, localStream]);

  // Set up realtime subscriptions
  useEffect(() => {
    if (!isConnected || !localStream) return;

    // Listen for new participants
    const participantsChannel = supabase
      .channel('participants')
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` },
        async (payload) => {
          const newParticipant = payload.new as Participant;
          if (newParticipant.peer_id !== peerId) {
            setParticipants(prev => [...prev, newParticipant]);
          }
        }
      )
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const deletedParticipant = payload.old as Participant;
          setParticipants(prev => prev.filter(p => p.peer_id !== deletedParticipant.peer_id));
          
          // Close peer connection
          const pc = peerConnectionsRef.current.get(deletedParticipant.peer_id);
          if (pc) {
            pc.close();
            peerConnectionsRef.current.delete(deletedParticipant.peer_id);
          }
          
          // Remove remote stream
          setRemoteStreams(prev => {
            const newMap = new Map(prev);
            newMap.delete(deletedParticipant.peer_id);
            return newMap;
          });
        }
      )
      .subscribe();

    // Listen for signaling messages
    const signalingChannel = supabase
      .channel('signaling')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'signaling', filter: `room_id=eq.${roomId}` },
        async (payload) => {
          const signal = payload.new as any;
          
          // Only process signals meant for this peer
          if (signal.to_peer_id === peerId || !signal.to_peer_id) {
            const { from_peer_id, signal_type, signal_data } = signal;
            
            if (from_peer_id === peerId) return; // Ignore own signals
            
            switch (signal_type) {
              case 'offer':
                await handleOffer(from_peer_id, signal_data, localStream);
                break;
              case 'answer':
                await handleAnswer(from_peer_id, signal_data);
                break;
              case 'ice-candidate':
                await handleIceCandidate(from_peer_id, signal_data);
                break;
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(participantsChannel);
      supabase.removeChannel(signalingChannel);
    };
  }, [isConnected, localStream, roomId, peerId, handleOffer, handleAnswer, handleIceCandidate]);

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