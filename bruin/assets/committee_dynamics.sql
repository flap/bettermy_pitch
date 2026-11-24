/* @bruin
name: analytics.committee_dynamics
type: pg.sql
description: Buying-committee signals per session and member — how interest and trust moved from the first to the last round.
materialization:
  type: table
@bruin */

with ranked as (
    select
        d.*,
        row_number() over (partition by session_id, member_id order by round asc, created_at asc) as first_rank,
        row_number() over (partition by session_id, member_id order by round desc, created_at desc) as last_rank
    from app.decisions d
)
select
    session_id,
    member_id,
    count(*) as rounds,
    max(interest) filter (where first_rank = 1) as first_interest,
    max(interest) filter (where last_rank = 1) as final_interest,
    max(trust) filter (where first_rank = 1) as first_trust,
    max(trust) filter (where last_rank = 1) as final_trust,
    max(interest) filter (where last_rank = 1) - max(interest) filter (where first_rank = 1) as interest_delta,
    max(trust) filter (where last_rank = 1) - max(trust) filter (where first_rank = 1) as trust_delta,
    max(action) filter (where last_rank = 1) as final_action,
    count(*) filter (where action in ('leans_in', 'takes_notes', 'nods', 'ready_to_buy')) as positive_signals,
    count(*) filter (where action in ('checks_phone', 'crosses_arms', 'pushes_back', 'leaves_meeting')) as negative_signals,
    bool_or(action = 'ready_to_buy') as reached_ready_to_buy,
    bool_or(action = 'leaves_meeting') as left_meeting,
    count(*) filter (where whisper <> '') as whispers,
    count(*) filter (where adaptation = 'raise_bar') as rounds_raised_bar,
    count(*) filter (where adaptation = 'interrupt') as rounds_interrupted,
    count(*) filter (where adaptation = 'ease_off') as rounds_eased_off
from ranked
group by session_id, member_id
