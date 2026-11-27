BEGIN;
ALTER TABLE public.communities DROP CONSTRAINT IF EXISTS communities_card_frame_check;
ALTER TABLE public.communities ADD CONSTRAINT communities_card_frame_check CHECK (card_frame IN ('none','claws','thorns','chain','royal'));
UPDATE public.communities SET card_frame='none' WHERE card_frame NOT IN ('none','claws','thorns','chain','royal');
COMMIT;