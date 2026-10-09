'use client';
import { MeetingRoom } from '@/components/meetings';
export default function Page({ params }: { params: { id: string } }) { return <MeetingRoom id={params.id} />; }
