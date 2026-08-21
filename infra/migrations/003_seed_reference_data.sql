-- Reference data seed: partner facilities and known geographic clusters for
-- Detroit, carried over from the prototype's MOCK_DATA.
--
-- This file contains NO patient data. The 12 demo patients live only in the
-- Flutter app's DEMO-gated seed and must never be loaded into a database that
-- also holds real records.

BEGIN;

INSERT INTO resources (id, name, type, address, location, hours, phone) VALUES
  ('r1',  'Detroit Rescue Mission',      'Shelter',      '150 Stimson St',      ST_SetSRID(ST_MakePoint(-83.0550, 42.3415), 4326)::geography, '24/7',          '(313) 993-6703'),
  ('r2',  'Covenant House MI',           'Shelter',      '2959 MLK Blvd',       ST_SetSRID(ST_MakePoint(-83.0750, 42.3480), 4326)::geography, '24/7',          '(313) 463-2000'),
  ('r3',  'COTS Detroit',                'Shelter',      '2630 W Grand Blvd',   ST_SetSRID(ST_MakePoint(-83.0845, 42.3655), 4326)::geography, '24/7',          '(313) 831-3777'),
  ('r4',  'Campus Martius Restroom',     'Restroom',     '800 Woodward Ave',    ST_SetSRID(ST_MakePoint(-83.0465, 42.3315), 4326)::geography, '6AM - 10PM',    'N/A'),
  ('r5',  'Spirit of Detroit Restroom',  'Restroom',     '2 Woodward Ave',      ST_SetSRID(ST_MakePoint(-83.0445, 42.3295), 4326)::geography, '8AM - 8PM',     'N/A'),
  ('r6',  'Capuchin Soup Kitchen',       'Soup Kitchen', '1820 Mt Elliott St',  ST_SetSRID(ST_MakePoint(-83.0150, 42.3550), 4326)::geography, '8AM - 4PM',     '(313) 579-2100'),
  ('r7',  'Pope Francis Center',         'Soup Kitchen', '438 St Antoine St',   ST_SetSRID(ST_MakePoint(-83.0425, 42.3335), 4326)::geography, '7AM - 11AM',    '(313) 963-5134'),
  ('r8',  'UDM Dental Clinic',           'Dental',       '2700 MLK Blvd',       ST_SetSRID(ST_MakePoint(-83.0720, 42.3460), 4326)::geography, '9AM - 5PM',     '(313) 494-6626'),
  ('r9',  'Advantage Health Dental',     'Dental',       '15400 W McNichols',   ST_SetSRID(ST_MakePoint(-83.1950, 42.4160), 4326)::geography, '8:30AM - 5PM',  '(313) 416-6262'),
  ('r10', 'Woodward CVS',                'Pharmacy',     '1037 Woodward Ave',   ST_SetSRID(ST_MakePoint(-83.0475, 42.3320), 4326)::geography, '8AM - 9PM',     '(313) 963-1007'),
  ('r11', 'Rite Aid Jefferson',          'Pharmacy',     '2121 W Jefferson',    ST_SetSRID(ST_MakePoint(-83.0650, 42.3250), 4326)::geography, '8AM - 10PM',    '(313) 259-3191'),
  ('r12', 'Henry Ford Hospital',         'Hospital',     '2799 W Grand Blvd',   ST_SetSRID(ST_MakePoint(-83.0850, 42.3670), 4326)::geography, '24/7',          '(313) 916-2600'),
  ('r13', 'CHASS Center',                'Hospital',     '5635 W Fort St',      ST_SetSRID(ST_MakePoint(-83.1055, 42.3105), 4326)::geography, '8AM - 5PM',     '(313) 849-3920')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, type = EXCLUDED.type, address = EXCLUDED.address,
  location = EXCLUDED.location, hours = EXCLUDED.hours, phone = EXCLUDED.phone,
  updated_at = now();

-- Coordinator-entered clusters. `computed = false` protects them from being
-- overwritten by the hotspot-recompute cron job.
INSERT INTO hotspots (id, name, type, intensity, patient_count, location, supply, computed) VALUES
  ('h1',  'Cass Corridor',        'Rising Need',      'High',     12, ST_SetSRID(ST_MakePoint(-83.0600, 42.3450), 4326)::geography, NULL,            false),
  ('h2',  'I-75 Underpass',       'Hepatitis C',      'Moderate',  5, ST_SetSRID(ST_MakePoint(-83.0450, 42.3380), 4326)::geography, NULL,            false),
  ('h3',  'Grand Circus',         'Rising Need',      'Low',       2, ST_SetSRID(ST_MakePoint(-83.0500, 42.3360), 4326)::geography, NULL,            false),
  ('h4',  'Brightmoor Area',      'Food Desert',      'High',      0, ST_SetSRID(ST_MakePoint(-83.2500, 42.4000), 4326)::geography, NULL,            false),
  ('h5',  'Delray Neighborhood',  'Pharmacy Desert',  'Moderate',  0, ST_SetSRID(ST_MakePoint(-83.1100, 42.3000), 4326)::geography, NULL,            false),
  ('h6',  'Highland Park Border', 'HIV',              'High',      8, ST_SetSRID(ST_MakePoint(-83.0800, 42.3900), 4326)::geography, NULL,            false),
  ('h7',  'New Center',           'COVID-19',         'Moderate', 15, ST_SetSRID(ST_MakePoint(-83.0750, 42.3680), 4326)::geography, NULL,            false),
  ('h8',  'Eastern Market',       'Scabies',          'Low',       4, ST_SetSRID(ST_MakePoint(-83.0380, 42.3480), 4326)::geography, NULL,            false),
  ('h9',  'Corktown',             'Rising Need',      'Moderate',  6, ST_SetSRID(ST_MakePoint(-83.0680, 42.3310), 4326)::geography, NULL,            false),
  ('h10', 'Southwest Detroit',    'Food Desert',      'High',      0, ST_SetSRID(ST_MakePoint(-83.1000, 42.3150), 4326)::geography, NULL,            false),
  ('h11', 'North End',            'Pharmacy Desert',  'Low',       0, ST_SetSRID(ST_MakePoint(-83.0700, 42.3800), 4326)::geography, NULL,            false),
  ('h12', 'Jefferson-Chalmers',   'Rising Need',      'Moderate',  9, ST_SetSRID(ST_MakePoint(-82.9350, 42.3650), 4326)::geography, NULL,            false),
  ('h13', 'Cass Park',            'Supply Usage',     'High',      0, ST_SetSRID(ST_MakePoint(-83.0590, 42.3410), 4326)::geography, 'Wound Care',    false),
  ('h14', 'Hart Plaza',           'Supply Usage',     'Moderate',  0, ST_SetSRID(ST_MakePoint(-83.0440, 42.3280), 4326)::geography, 'Narcan',        false),
  ('h15', 'Grand Circus',         'Supply Usage',     'Moderate',  0, ST_SetSRID(ST_MakePoint(-83.0510, 42.3370), 4326)::geography, 'Albuterol',     false),
  ('h16', 'Midtown',              'Supply Usage',     'Low',       0, ST_SetSRID(ST_MakePoint(-83.0660, 42.3530), 4326)::geography, 'Insulin',       false),
  ('h17', 'Eastern Market',       'Supply Usage',     'Moderate',  0, ST_SetSRID(ST_MakePoint(-83.0390, 42.3490), 4326)::geography, 'Tetanus Shots', false),
  ('h18', 'New Center',           'Supply Usage',     'High',      0, ST_SetSRID(ST_MakePoint(-83.0770, 42.3695), 4326)::geography, 'Tamiflu',       false),
  ('h19', 'Southwest',            'Supply Usage',     'Moderate',  0, ST_SetSRID(ST_MakePoint(-83.0960, 42.3190), 4326)::geography, 'Atorvastatin',  false)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, type = EXCLUDED.type, intensity = EXCLUDED.intensity,
  patient_count = EXCLUDED.patient_count, location = EXCLUDED.location,
  supply = EXCLUDED.supply, updated_at = now();

COMMIT;
