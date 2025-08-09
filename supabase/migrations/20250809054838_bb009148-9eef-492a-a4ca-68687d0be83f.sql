-- Create rooms table
CREATE TABLE public.rooms (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    room_code TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create participants table
CREATE TABLE public.participants (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    user_name TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    is_active BOOLEAN DEFAULT true,
    UNIQUE(room_id, peer_id)
);

-- Create signaling table for WebRTC
CREATE TABLE public.signaling (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    from_peer_id TEXT NOT NULL,
    to_peer_id TEXT,
    signal_type TEXT NOT NULL, -- 'offer', 'answer', 'ice-candidate'
    signal_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signaling ENABLE ROW LEVEL SECURITY;

-- Create policies (public access for video calls)
CREATE POLICY "Anyone can view rooms" ON public.rooms FOR SELECT USING (true);
CREATE POLICY "Anyone can create rooms" ON public.rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update rooms" ON public.rooms FOR UPDATE USING (true);

CREATE POLICY "Anyone can view participants" ON public.participants FOR SELECT USING (true);
CREATE POLICY "Anyone can join rooms" ON public.participants FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update participants" ON public.participants FOR UPDATE USING (true);
CREATE POLICY "Anyone can leave rooms" ON public.participants FOR DELETE USING (true);

CREATE POLICY "Anyone can view signaling" ON public.signaling FOR SELECT USING (true);
CREATE POLICY "Anyone can send signals" ON public.signaling FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete old signals" ON public.signaling FOR DELETE USING (true);

-- Enable realtime for all tables
ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.participants REPLICA IDENTITY FULL;
ALTER TABLE public.signaling REPLICA IDENTITY FULL;

ALTER publication supabase_realtime ADD TABLE public.rooms;
ALTER publication supabase_realtime ADD TABLE public.participants;
ALTER publication supabase_realtime ADD TABLE public.signaling;

-- Function to clean old signaling data
CREATE OR REPLACE FUNCTION public.cleanup_old_signals()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM public.signaling 
    WHERE created_at < now() - interval '1 hour';
END;
$$;

-- Trigger to clean participants when they disconnect
CREATE OR REPLACE FUNCTION public.cleanup_inactive_participants()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Clean up participants that have been inactive for more than 30 seconds
    DELETE FROM public.participants 
    WHERE room_id = NEW.room_id 
    AND joined_at < now() - interval '30 seconds' 
    AND is_active = false;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER cleanup_participants_trigger
    AFTER INSERT ON public.participants
    FOR EACH ROW
    EXECUTE FUNCTION public.cleanup_inactive_participants();