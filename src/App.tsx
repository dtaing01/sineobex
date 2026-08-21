import React, { useState } from 'react';
import { 
  Home, Users, Map as MapIcon, Package, BarChart3, 
  Plus, Search, MapPin, Calendar, AlertCircle, 
  ChevronLeft, Save, Stethoscope, TrendingUp, TrendingDown, Minus, Info, Navigation,
  Clock, History as HistoryIcon, User, FileText, Mail, Briefcase,
  Shield, Bell, MessageSquare, LogOut, ChevronRight, Settings2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { 
  Card, CardContent, CardHeader, CardTitle 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell 
} from 'recharts';
import { cn } from '@/lib/utils';

// --- 1. SIMPLE DATA (All in one place for easy editing) ---
const MOCK_DATA = {
  currentUser: { name: 'Sarah Chen, RN', role: 'Team Lead' },
  patients: [
    { 
      id: '1', name: 'John Doe', age: 45, dob: '1979-05-12', risk: 'High', loc: 'Cass Park', 
      lat: 42.3400, lng: -83.0580,
      tags: ['Chronic Wound', 'Hypertension'], followUp: true,
      nextFollowUp: '2026-04-24',
      flags: ['Chronic Disease'],
      commonLocations: [
        { name: 'Cass Park (North)', lat: 42.3405, lng: -83.0585, date: '2026-04-11', day: 'Saturday', time: '09:15 AM' },
        { name: 'St. Peter Church', lat: 42.3420, lng: -83.0610, date: '2026-04-08', day: 'Wednesday', time: '02:30 PM' },
        { name: 'MLK Blvd Underpass', lat: 42.3450, lng: -83.0650, date: '2026-04-05', day: 'Sunday', time: '11:00 AM' }
      ],
      history: [
        { 
          id: 'h1', 
          date: '2026-04-10', 
          provider: 'Dr. Mike', 
          needs: 'Chronic Wound Care',
          encounterLoc: 'Cass Park (North Side)',
          notes: 'Wound cleaning performed. Prescribed Amoxicillin for infection.', 
          followUpSet: true, 
          followUpDate: '2026-04-24',
          followUpLoc: 'Cass Park (North Side)',
          supplies: ['Gauze (2)', 'Saline (1)', 'Amoxicillin 500mg (1 tab twice daily for 7 days)'] 
        },
        { 
          id: 'h2', 
          date: '2025-12-15', 
          provider: 'Sarah RN', 
          needs: 'Initial Wound Assessment',
          encounterLoc: 'Cass Park (South Side)',
          notes: 'Large ulcer on left ankle. Signs of infection.', 
          followUpSet: true, 
          followUpDate: '2025-12-29',
          followUpLoc: 'Cass Park',
          supplies: ['Gauze (1)', 'Antiseptic Wipe', 'Socks (1 pair)', 'Granola Bar'] 
        }
      ]
    },
    { 
      id: '2', name: 'Jane Smith', age: 32, dob: '1992-08-24', risk: 'Moderate', loc: 'Detroit Public Library', 
      lat: 42.3585, lng: -83.0665,
      tags: ['Prenatal'], followUp: true,
      nextFollowUp: '2026-05-20',
      flags: ['Pregnancy'],
      commonLocations: [
        { name: 'Library Entrance', lat: 42.3585, lng: -83.0665, date: '2026-04-11', day: 'Saturday', time: '11:00 AM' },
        { name: 'Wayne State Student Center', lat: 42.3550, lng: -83.0680, date: '2026-04-09', day: 'Thursday', time: '01:30 PM' },
        { name: 'Warren Ave Bus Stop', lat: 42.3575, lng: -83.0690, date: '2026-04-06', day: 'Monday', time: '04:45 PM' }
      ],
      history: [
        { 
          id: 'h3', 
          date: '2026-04-08', 
          provider: 'Sarah RN', 
          needs: 'Prenatal Checkup',
          encounterLoc: 'Detroit Public Library',
          notes: 'Vitals stable. Referred to prenatal clinic. Provided vitamins and outreach gear.', 
          followUpSet: true, 
          followUpDate: '2026-05-20',
          followUpLoc: 'Detroit Public Library',
          supplies: ['Prenatal Vitamins (30 day supply)', 'Water (2)', 'Maternity Shirt', 'Walking Shoes'] 
        }
      ]
    },
    { 
      id: '3', name: 'Robert Williams', age: 58, dob: '1966-11-03', risk: 'Low', loc: 'Grand Circus Park', 
      lat: 42.3359, lng: -83.0497,
      tags: ['Diabetes'], followUp: true,
      nextFollowUp: '2026-07-09',
      flags: ['Chronic Disease'],
      commonLocations: [
        { name: 'Grand Circus (West)', lat: 42.3360, lng: -83.0500, date: '2026-04-10', day: 'Friday', time: '08:30 AM' },
        { name: 'Adams St Bench', lat: 42.3370, lng: -83.0510, date: '2026-04-07', day: 'Tuesday', time: '12:00 PM' },
        { name: 'Woodward Ave Corner', lat: 42.3350, lng: -83.0485, date: '2026-04-04', day: 'Saturday', time: '03:15 PM' }
      ],
      history: [
        {
          id: 'h5',
          date: '2026-04-09',
          provider: 'Sarah RN',
          needs: 'Blood Sugar Monitoring',
          encounterLoc: 'Grand Circus Park',
          notes: 'Blood sugar slightly elevated. Discussed diet. Provided diabetic supplies and clothing.',
          followUpSet: true,
          followUpDate: '2026-07-09',
          followUpLoc: 'Grand Circus Park',
          supplies: ['Alcohol Swabs', 'Lancets', 'Socks (2 pairs)', 'Fruit Pack']
        }
      ]
    },
    { 
      id: '4', name: 'Maria Garcia', age: 29, dob: '1997-02-14', risk: 'High', loc: 'Michigan & Trumbull', 
      lat: 42.3316, lng: -83.0688,
      tags: ['Mental Health', 'Infection'], followUp: true,
      nextFollowUp: '2026-05-02',
      flags: ['Mental Health', 'Chronic Disease'],
      commonLocations: [
        { name: 'Michigan & Trumbull', lat: 42.3316, lng: -83.0688, date: '2026-04-11', day: 'Saturday', time: '09:45 AM' },
        { name: 'Roosevelt Park', lat: 42.3300, lng: -83.0720, date: '2026-04-08', day: 'Wednesday', time: '02:30 PM' },
        { name: 'Trumbull St Shelter', lat: 42.3330, lng: -83.0670, date: '2026-04-05', day: 'Sunday', time: '11:15 AM' }
      ],
      history: [
        { 
          id: 'h4', 
          date: '2026-04-11', 
          provider: 'Dr. Mike', 
          needs: 'Wound Check & Mental Health Support',
          encounterLoc: 'Michigan & Trumbull',
          notes: 'Agitated but cooperative. Wound check needed. Started on Cephalexin.', 
          followUpSet: true, 
          followUpDate: '2026-05-02',
          followUpLoc: 'Michigan & Trumbull',
          supplies: ['Gauze (1)', 'Hygiene Kit', 'Cephalexin 500mg (1 tab 4 times daily for 10 days)', 'Winter Coat'] 
        }
      ]
    },
    { 
      id: '5', name: 'David Lee', age: 52, dob: '1974-06-30', risk: 'Moderate', loc: 'Eastern Market', 
      lat: 42.3470, lng: -83.0400,
      tags: ['Hypertension'], followUp: true,
      nextFollowUp: '2026-05-19',
      flags: ['Chronic Disease'],
      commonLocations: [
        { name: 'Eastern Market Shed 3', lat: 42.3470, lng: -83.0400, date: '2026-04-10', day: 'Friday', time: '07:15 AM' },
        { name: 'Wilkins St Underpass', lat: 42.3485, lng: -83.0420, date: '2026-04-07', day: 'Tuesday', time: '01:00 PM' },
        { name: 'Riopelle St Corner', lat: 42.3460, lng: -83.0410, date: '2026-04-04', day: 'Saturday', time: '10:45 AM' }
      ],
      history: [
        {
          id: 'h6',
          date: '2026-04-07',
          provider: 'Sarah RN',
          needs: 'BP Check',
          encounterLoc: 'Eastern Market',
          notes: 'BP 145/90. Encouraged medication adherence. Provided outreach supplies.',
          followUpSet: true,
          followUpDate: '2026-05-19',
          followUpLoc: 'Eastern Market',
          supplies: ['Blood Pressure Log', 'Socks (1 pair)', 'T-Shirt', 'Bottled Water']
        }
      ]
    },
    { 
      id: '6', name: 'Elena Rodriguez', age: 41, dob: '1985-01-12', risk: 'High', loc: 'Midtown Detroit', 
      lat: 42.3520, lng: -83.0650,
      tags: ['Infection'], followUp: true,
      nextFollowUp: '2026-04-24',
      flags: ['Chronic Disease'],
      commonLocations: [
        { name: 'Midtown (Cass Ave)', lat: 42.3520, lng: -83.0650, date: '2026-04-11', day: 'Saturday', time: '12:30 PM' },
        { name: 'Selden St Alley', lat: 42.3535, lng: -83.0670, date: '2026-04-09', day: 'Thursday', time: '03:45 PM' },
        { name: 'Canfield St Bench', lat: 42.3510, lng: -83.0660, date: '2026-04-06', day: 'Monday', time: '09:15 AM' }
      ],
      history: [
        {
          id: 'h7',
          date: '2026-04-10',
          provider: 'Dr. Mike',
          needs: 'Infection Management',
          encounterLoc: 'Midtown Detroit',
          notes: 'Started on oral Amoxicillin for skin infection. Provided shoes and food.',
          followUpSet: true,
          followUpDate: '2026-04-24',
          followUpLoc: 'Midtown Detroit',
          supplies: ['Amoxicillin 875mg (1 tab twice daily for 10 days)', 'Gauze', 'Shoes (Size 9)', 'Food Pack']
        }
      ]
    },
    { 
      id: '7', name: 'James Wilson', age: 37, dob: '1989-03-22', risk: 'Moderate', loc: 'Beacon Park', 
      lat: 42.3340, lng: -83.0550,
      tags: ['Mental Health'], followUp: true,
      nextFollowUp: '2026-01-01',
      flags: ['Mental Health'],
      commonLocations: [
        { name: 'Beacon Park (South)', lat: 42.3340, lng: -83.0550, date: '2026-04-10', day: 'Friday', time: '11:15 AM' },
        { name: 'Grand River Ave Bench', lat: 42.3355, lng: -83.0570, date: '2026-04-07', day: 'Tuesday', time: '02:00 PM' },
        { name: 'Cass Ave Corner', lat: 42.3330, lng: -83.0540, date: '2026-04-04', day: 'Saturday', time: '08:45 AM' }
      ],
      history: [
        {
          id: 'h8',
          date: '2025-11-20',
          provider: 'Sarah RN',
          needs: 'Mental Health Outreach',
          encounterLoc: 'Beacon Park',
          notes: 'Stable mood. Provided resource list for counseling and warm clothing.',
          followUpSet: true,
          followUpDate: '2026-01-01',
          followUpLoc: 'Beacon Park',
          supplies: ['Resource Guide', 'Water', 'Socks', 'Sweatshirt']
        }
      ]
    },
    { 
      id: '8', name: 'Linda Simmons', age: 63, dob: '1963-09-15', risk: 'Low', loc: 'Corktown', 
      lat: 42.3300, lng: -83.0700,
      tags: ['Diabetes'], followUp: true,
      nextFollowUp: '2026-07-05',
      flags: ['Chronic Disease'],
      commonLocations: [
        { name: 'Corktown (Trumbull St)', lat: 42.3300, lng: -83.0700, date: '2026-04-11', day: 'Saturday', time: '10:00 AM' },
        { name: 'Old Tiger Stadium Site', lat: 42.3320, lng: -83.0690, date: '2026-04-08', day: 'Wednesday', time: '01:15 PM' },
        { name: 'Michigan Ave Bench', lat: 42.3310, lng: -83.0710, date: '2026-04-05', day: 'Sunday', time: '04:30 PM' }
      ],
      history: [
        {
          id: 'h9',
          date: '2026-04-05',
          provider: 'Sarah RN',
          needs: 'Diabetes Education',
          encounterLoc: 'Corktown',
          notes: 'Reviewed foot care and insulin storage. Provided specialized footwear.',
          followUpSet: true,
          followUpDate: '2026-07-05',
          followUpLoc: 'Corktown',
          supplies: ['Socks (Diabetic)', 'Insulin Cooler Bag', 'Walking Shoes', 'Healthy Snack Pack']
        }
      ]
    },
    { 
      id: '9', name: 'Michael Brown', age: 48, dob: '1978-12-01', risk: 'High', loc: 'New Center', 
      lat: 42.3690, lng: -83.0760,
      tags: ['Chronic Wound'], followUp: true,
      nextFollowUp: '2026-04-25',
      flags: ['Chronic Disease'],
      commonLocations: [
        { name: 'New Center (Grand Blvd)', lat: 42.3690, lng: -83.0760, date: '2026-04-10', day: 'Friday', time: '09:30 AM' },
        { name: 'Fisher Bldg Area', lat: 42.3680, lng: -83.0780, date: '2026-04-07', day: 'Tuesday', time: '12:45 PM' },
        { name: 'Lothrop St Corner', lat: 42.3700, lng: -83.0750, date: '2026-04-04', day: 'Saturday', time: '03:00 PM' }
      ],
      history: [
        {
          id: 'h10',
          date: '2026-04-11',
          provider: 'Dr. Mike',
          needs: 'Wound Debridement',
          encounterLoc: 'New Center',
          notes: 'Performed minor debridement. Wound bed looks better. Added Cephalexin.',
          followUpSet: true,
          followUpDate: '2026-04-25',
          followUpLoc: 'New Center',
          supplies: ['Gauze', 'Saline', 'Silver Dressing', 'Cephalexin 500mg (1 tab 4 times daily for 7 days)', 'Jeans']
        }
      ]
    },
    { 
      id: '10', name: 'Patricia Harris', age: 55, dob: '1971-04-20', risk: 'Low', loc: 'Lafayette Park', 
      lat: 42.3370, lng: -83.0350,
      tags: ['Hypertension'], followUp: true,
      nextFollowUp: '2026-07-04',
      flags: ['Chronic Disease'],
      commonLocations: [
        { name: 'Lafayette Park (East)', lat: 42.3370, lng: -83.0350, date: '2026-04-11', day: 'Saturday', time: '08:15 AM' },
        { name: 'Rivard St Path', lat: 42.3385, lng: -83.0370, date: '2026-04-09', day: 'Thursday', time: '11:30 AM' },
        { name: 'Antietam St Bench', lat: 42.3360, lng: -83.0340, date: '2026-04-06', day: 'Monday', time: '02:45 PM' }
      ],
      history: [
        {
          id: 'h11',
          date: '2026-04-04',
          provider: 'Sarah RN',
          needs: 'BP Screening',
          encounterLoc: 'Lafayette Park',
          notes: 'BP 130/85. Within acceptable range. Provided basic essentials.',
          followUpSet: true,
          followUpDate: '2026-07-04',
          followUpLoc: 'Lafayette Park',
          supplies: ['Water', 'Socks', 'Light Jacket', 'Trail Mix']
        }
      ]
    },
    { 
      id: '11', name: 'Thomas Jackson', age: 39, dob: '1987-07-07', risk: 'Moderate', loc: 'West Village', 
      lat: 42.3550, lng: -82.9950,
      tags: ['Mental Health'], followUp: true,
      nextFollowUp: '2026-05-21',
      flags: ['Mental Health'],
      commonLocations: [
        { name: 'West Village (Agnes St)', lat: 42.3550, lng: -82.9950, date: '2026-04-10', day: 'Friday', time: '10:45 AM' },
        { name: 'Van Dyke Ave Bench', lat: 42.3565, lng: -82.9970, date: '2026-04-07', day: 'Tuesday', time: '01:15 PM' },
        { name: 'Kercheval Ave Corner', lat: 42.3540, lng: -82.9930, date: '2026-04-04', day: 'Saturday', time: '04:00 PM' }
      ],
      history: [
        {
          id: 'h12',
          date: '2026-04-09',
          provider: 'Sarah RN',
          needs: 'Crisis Intervention',
          encounterLoc: 'West Village',
          notes: 'De-escalated situation. Connected with mobile crisis team. Provided survival gear.',
          followUpSet: true,
          followUpDate: '2026-05-21',
          followUpLoc: 'West Village',
          supplies: ['Hygiene Kit', 'Snack Pack', 'Blanket', 'Shoes']
        }
      ]
    },
    { 
      id: '12', name: 'Karen Vance', age: 44, dob: '1982-10-31', risk: 'High', loc: 'Southwest Detroit', 
      lat: 42.3180, lng: -83.0950,
      tags: ['Infection'], followUp: true,
      nextFollowUp: '2026-04-25',
      flags: ['Chronic Disease'],
      commonLocations: [
        { name: 'Southwest (Vernor Hwy)', lat: 42.3180, lng: -83.0950, date: '2026-04-11', day: 'Saturday', time: '11:30 AM' },
        { name: 'Clark Park (North)', lat: 42.3160, lng: -83.0970, date: '2026-04-08', day: 'Wednesday', time: '02:45 PM' },
        { name: 'Scotten St Corner', lat: 42.3200, lng: -83.0930, date: '2026-04-05', day: 'Sunday', time: '09:15 AM' }
      ],
      history: [
        {
          id: 'h13',
          date: '2026-04-11',
          provider: 'Dr. Mike',
          needs: 'Abscess Drainage',
          encounterLoc: 'Southwest Detroit',
          notes: 'Drained small abscess. Packed with gauze. Prescribed Amoxicillin.',
          followUpSet: true,
          followUpDate: '2026-04-25',
          followUpLoc: 'Southwest Detroit',
          supplies: ['Gauze', 'Saline', 'Packing Strip', 'Amoxicillin 500mg (1 tab 3 times daily for 7 days)', 'Socks']
        }
      ]
    },
  ],
  tasks: [
    { id: 't1', text: 'Restock wound care kits in Van 1', status: 'pending', priority: 'High' },
    { id: 't2', text: 'Call Detroit Rescue Mission for bed availability', status: 'pending', priority: 'Moderate' },
    { id: 't3', text: 'Update patient logs from morning shift', status: 'completed', priority: 'Low' },
  ],
  outreachActions: [
    { id: 'a1', time: '14:00', location: 'Eastern Market', goal: 'Water distribution' },
    { id: 'a2', time: '16:30', location: 'I-75 Underpass', goal: 'Wound care follow-ups' },
  ],
  inventory: [
    { id: 's1', name: 'Gauze', stock: 15, min: 20, unit: 'packs', category: 'Medical' },
    { id: 's2', name: 'Saline', stock: 8, min: 10, unit: 'bottles', category: 'Medical' },
    { id: 's3', name: 'Amoxicillin 500mg', stock: 12, min: 15, unit: 'bottles', category: 'Medical' },
    { id: 's4', name: 'Cephalexin 500mg', stock: 10, min: 15, unit: 'bottles', category: 'Medical' },
    { id: 's5', name: 'Tamiflu', stock: 4, min: 10, unit: 'bottles', category: 'Medical', orderedAt: '2026-04-11 09:00', orderedBy: 'Sarah Chen, RN' },
    { id: 's6', name: 'Albuterol Inhalers', stock: 6, min: 10, unit: 'units', category: 'Medical', orderedAt: '2026-04-11 11:30', orderedBy: 'Sarah Chen, RN' },
    { id: 's7', name: 'Insulin', stock: 5, min: 8, unit: 'vials', category: 'Medical' },
    { id: 's8', name: 'Narcan', stock: 18, min: 20, unit: 'kits', category: 'Medical' },
    { id: 's9', name: 'Prenatal Vitamins', stock: 5, min: 10, unit: 'bottles', category: 'Medical' },
    { id: 's10', name: 'Water', stock: 12, min: 24, unit: 'bottles', category: 'Essentials' },
    { id: 's11', name: 'Food Packs', stock: 15, min: 20, unit: 'packs', category: 'Essentials' },
    { id: 's12', name: 'Hygiene Kits', stock: 22, min: 10, unit: 'kits', category: 'Essentials' },
    { id: 's13', name: 'Socks', stock: 45, min: 15, unit: 'pairs', category: 'Clothing' },
    { id: 's14', name: 'Shoes', stock: 8, min: 10, unit: 'pairs', category: 'Clothing' },
    { id: 's15', name: 'Coats/Jackets', stock: 12, min: 10, unit: 'units', category: 'Clothing' },
    { id: 's16', name: 'T-Shirts', stock: 25, min: 15, unit: 'units', category: 'Clothing' },
    { id: 's17', name: 'Silver Sulfadiazine', stock: 0, min: 5, unit: 'jars', category: 'Medical', orderedAt: '2026-04-11 10:30', orderedBy: 'Sarah Chen, RN' },
    { id: 's18', name: 'Tetanus Vaccines', stock: 0, min: 10, unit: 'doses', category: 'Medical', orderedAt: '2026-04-10 14:15', orderedBy: 'Dr. Mike' },
    { id: 's19', name: 'Walking Shoes (Size 10)', stock: 0, min: 3, unit: 'pairs', category: 'Clothing', orderedAt: '2026-04-11 15:00', orderedBy: 'Sarah Chen, RN' },
    { id: 's20', name: 'Acetaminophen', stock: 25, min: 30, unit: 'bottles', category: 'Medical' },
    { id: 's21', name: 'Hand Warmers', stock: 50, min: 100, unit: 'packs', category: 'Essentials' },
    { id: 's22', name: 'Ibuprofen', stock: 20, min: 30, unit: 'bottles', category: 'Medical' },
    { id: 's23', name: 'Moisturizer', stock: 15, min: 20, unit: 'tubes', category: 'Essentials' },
    { id: 's24', name: 'Cetirizine', stock: 12, min: 15, unit: 'packs', category: 'Medical' },
    { id: 's25', name: 'Loratadine', stock: 8, min: 15, unit: 'packs', category: 'Medical' },
    { id: 's26', name: 'Fluticasone Nasal Spray', stock: 5, min: 10, unit: 'units', category: 'Medical' },
    { id: 's27', name: 'Hydrocortisone Cream', stock: 10, min: 15, unit: 'tubes', category: 'Medical' },
    { id: 's28', name: 'Sunscreen', stock: 15, min: 25, unit: 'bottles', category: 'Essentials' },
    { id: 's29', name: 'Hats', stock: 30, min: 40, unit: 'units', category: 'Clothing' },
    { id: 's30', name: 'Electrolyte Packets', stock: 100, min: 150, unit: 'packs', category: 'Essentials' },
    { id: 's31', name: 'Cooling Towels', stock: 20, min: 30, unit: 'units', category: 'Essentials' },
    { id: 's32', name: 'Clotrimazole Cream', stock: 8, min: 12, unit: 'tubes', category: 'Medical' },
    { id: 's33', name: 'Masks', stock: 500, min: 1000, unit: 'units', category: 'Medical' },
    { id: 's34', name: 'Dextromethorphan', stock: 10, min: 15, unit: 'bottles', category: 'Medical' },
    { id: 's35', name: 'Cough Drops', stock: 40, min: 60, unit: 'packs', category: 'Medical' },
    { id: 's36', name: 'Blankets', stock: 25, min: 50, unit: 'units', category: 'Essentials' },
    { id: 's37', name: 'Petroleum Jelly', stock: 15, min: 20, unit: 'jars', category: 'Essentials' },
  ],
  resources: [
    { id: 'r1', name: 'Detroit Rescue Mission', type: 'Shelter', loc: '150 Stimson St', lat: 42.3415, lng: -83.0550, hours: '24/7', phone: '(313) 993-6703' },
    { id: 'r2', name: 'Covenant House MI', type: 'Shelter', loc: '2959 MLK Blvd', lat: 42.3480, lng: -83.0750, hours: '24/7', phone: '(313) 463-2000' },
    { id: 'r3', name: 'COTS Detroit', type: 'Shelter', loc: '2630 W Grand Blvd', lat: 42.3655, lng: -83.0845, hours: '24/7', phone: '(313) 831-3777' },
    { id: 'r4', name: 'Campus Martius Restroom', type: 'Restroom', loc: '800 Woodward Ave', lat: 42.3315, lng: -83.0465, hours: '6AM - 10PM', phone: 'N/A' },
    { id: 'r5', name: 'Spirit of Detroit Restroom', type: 'Restroom', loc: '2 Woodward Ave', lat: 42.3295, lng: -83.0445, hours: '8AM - 8PM', phone: 'N/A' },
    { id: 'r6', name: 'Capuchin Soup Kitchen', type: 'Soup Kitchen', loc: '1820 Mt Elliott St', lat: 42.3550, lng: -83.0150, hours: '8AM - 4PM', phone: '(313) 579-2100' },
    { id: 'r7', name: 'Pope Francis Center', type: 'Soup Kitchen', loc: '438 St Antoine St', lat: 42.3335, lng: -83.0425, hours: '7AM - 11AM', phone: '(313) 963-5134' },
    { id: 'r8', name: 'UDM Dental Clinic', type: 'Dental', loc: '2700 MLK Blvd', lat: 42.3460, lng: -83.0720, hours: '9AM - 5PM', phone: '(313) 494-6626' },
    { id: 'r9', name: 'Advantage Health Dental', type: 'Dental', loc: '15400 W McNichols', lat: 42.4160, lng: -83.1950, hours: '8:30AM - 5PM', phone: '(313) 416-6262' },
    { id: 'r10', name: 'Woodward CVS', type: 'Pharmacy', loc: '1037 Woodward Ave', lat: 42.3320, lng: -83.0475, hours: '8AM - 9PM', phone: '(313) 963-1007' },
    { id: 'r11', name: 'Rite Aid Jefferson', type: 'Pharmacy', loc: '2121 W Jefferson', lat: 42.3250, lng: -83.0650, hours: '8AM - 10PM', phone: '(313) 259-3191' },
    { id: 'r12', name: 'Henry Ford Hospital', type: 'Hospital', loc: '2799 W Grand Blvd', lat: 42.3670, lng: -83.0850, hours: '24/7', phone: '(313) 916-2600' },
    { id: 'r13', name: 'CHASS Center', type: 'Hospital', loc: '5635 W Fort St', lat: 42.3105, lng: -83.1055, hours: '8AM - 5PM', phone: '(313) 849-3920' },
  ],
  hotspots: [
    { id: 'h1', name: 'Cass Corridor', type: 'Rising Need', intensity: 'High', patients: 12, lat: 42.3450, lng: -83.0600 },
    { id: 'h2', name: 'I-75 Underpass', type: 'Hepatitis C', intensity: 'Moderate', patients: 5, lat: 42.3380, lng: -83.0450 },
    { id: 'h3', name: 'Grand Circus', type: 'Rising Need', intensity: 'Low', patients: 2, lat: 42.3360, lng: -83.0500 },
    { id: 'h4', name: 'Brightmoor Area', type: 'Food Desert', intensity: 'High', patients: 0, lat: 42.4000, lng: -83.2500 },
    { id: 'h5', name: 'Delray Neighborhood', type: 'Pharmacy Desert', intensity: 'Moderate', patients: 0, lat: 42.3000, lng: -83.1100 },
    { id: 'h6', name: 'Highland Park Border', type: 'HIV', intensity: 'High', patients: 8, lat: 42.3900, lng: -83.0800 },
    { id: 'h7', name: 'New Center', type: 'COVID-19', intensity: 'Moderate', patients: 15, lat: 42.3680, lng: -83.0750 },
    { id: 'h8', name: 'Eastern Market', type: 'Scabies', intensity: 'Low', patients: 4, lat: 42.3480, lng: -83.0380 },
    { id: 'h9', name: 'Corktown', type: 'Rising Need', intensity: 'Moderate', patients: 6, lat: 42.3310, lng: -83.0680 },
    { id: 'h10', name: 'Southwest Detroit', type: 'Food Desert', intensity: 'High', patients: 0, lat: 42.3150, lng: -83.1000 },
    { id: 'h11', name: 'North End', type: 'Pharmacy Desert', intensity: 'Low', patients: 0, lat: 42.3800, lng: -83.0700 },
    { id: 'h12', name: 'Jefferson-Chalmers', type: 'Rising Need', intensity: 'Moderate', patients: 9, lat: 42.3650, lng: -82.9350 },
    { id: 'h13', name: 'Cass Park', type: 'Supply Usage', intensity: 'High', patients: 0, lat: 42.3410, lng: -83.0590, supply: 'Wound Care' },
    { id: 'h14', name: 'Hart Plaza', type: 'Supply Usage', intensity: 'Moderate', patients: 0, lat: 42.3280, lng: -83.0440, supply: 'Narcan' },
    { id: 'h15', name: 'Grand Circus', type: 'Supply Usage', intensity: 'Moderate', patients: 0, lat: 42.3370, lng: -83.0510, supply: 'Albuterol' },
    { id: 'h16', name: 'Midtown', type: 'Supply Usage', intensity: 'Low', patients: 0, lat: 42.3530, lng: -83.0660, supply: 'Insulin' },
    { id: 'h17', name: 'Eastern Market', type: 'Supply Usage', intensity: 'Moderate', patients: 0, lat: 42.3490, lng: -83.0390, supply: 'Tetanus Shots' },
    { id: 'h18', name: 'New Center', type: 'Supply Usage', intensity: 'High', patients: 0, lat: 42.3695, lng: -83.0770, supply: 'Tamiflu' },
    { id: 'h19', name: 'Southwest', type: 'Supply Usage', intensity: 'Moderate', patients: 0, lat: 42.3190, lng: -83.0960, supply: 'Atorvastatin' },
  ],
  usageStats: [
    { name: 'Skid Row', value: 45 },
    { name: 'Underpass', value: 30 },
    { name: 'Library', value: 15 },
    { name: 'Parks', value: 10 },
  ],
  categoryStats: [
    { name: 'Medical', usage: 65 },
    { name: 'Essentials', usage: 85 },
    { name: 'Clothing', usage: 25 },
  ],
  stats: [
    { day: 'Mon', count: 12, highRisk: 2 }, { day: 'Tue', count: 18, highRisk: 5 }, { day: 'Wed', count: 15, highRisk: 3 },
    { day: 'Thu', count: 22, highRisk: 8 }, { day: 'Fri', count: 30, highRisk: 12 }
  ],
  monthlyImpact: [
    { month: 'Jan', encounters: 120, uniquePatients: 80, newPatients: 30, repeatPatients: 50 },
    { month: 'Feb', encounters: 150, uniquePatients: 95, newPatients: 40, repeatPatients: 55 },
    { month: 'Mar', encounters: 190, uniquePatients: 110, newPatients: 45, repeatPatients: 65 },
    { month: 'Apr', encounters: 310, uniquePatients: 110, newPatients: 60, repeatPatients: 50 },
  ],
  impactMetrics: [
    { label: 'Wounds Treated', value: '1,240', trend: '+15%' },
    { label: 'Referrals Made', value: '850', trend: '+8%' },
    { label: 'Hygiene Kits', value: '1,850', trend: '+18%' },
    { label: 'Lives Impacted', value: '3,200', trend: '+12%' },
  ],
  seasonalDemand: [
    { month: 'Jan', items: ['Acetaminophen', 'Hand Warmers'], intensity: 95 },
    { month: 'Feb', items: ['Ibuprofen', 'Moisturizer'], intensity: 88 },
    { month: 'Mar', items: ['Cetirizine', 'Albuterol'], intensity: 82 },
    { month: 'Apr', items: ['Loratadine', 'Fluticasone Nasal Spray'], intensity: 90 },
    { month: 'May', items: ['Hydrocortisone Cream', 'Sunscreen'], intensity: 75 },
    { month: 'Jun', items: ['Hats', 'Electrolyte Packets', 'Sunscreen', 'Cooling Towels'], intensity: 92 },
    { month: 'Jul', items: ['Hats', 'Electrolyte Packets', 'Sunscreen', 'Cooling Towels'], intensity: 98 },
    { month: 'Aug', items: ['Clotrimazole Cream', 'Hats', 'Electrolyte Packets', 'Sunscreen', 'Cooling Towels'], intensity: 94 },
    { month: 'Sep', items: ['Masks', 'Acetaminophen', 'Albuterol'], intensity: 85 },
    { month: 'Oct', items: ['Dextromethorphan', 'Albuterol'], intensity: 88 },
    { month: 'Nov', items: ['Cough Drops', 'Blankets'], intensity: 92 },
    { month: 'Dec', items: ['Socks', 'Petroleum Jelly'], intensity: 96 },
  ],
  supplyUsageByRegion: [
    { region: 'Cass Corridor', supply: 'Wound Care', usage: 145 },
    { region: 'Midtown', supply: 'Hygiene Kits', usage: 98 },
    { region: 'Downtown', supply: 'Narcan Kits', usage: 112 },
    { region: 'Southwest', supply: 'Clothing', usage: 167 },
    { region: 'New Center', supply: 'Food Packs', usage: 84 },
  ],
  continuityData: [
    { label: 'Primary Care Connected (YTD)', value: 345, total: 395, color: 'bg-emerald-500' },
    { label: 'Hospital Readmissions (YTD)', value: 24, total: 395, color: 'bg-rose-500' },
  ],
  progressOverTime: [
    { metric: 'Service Engagement', baseline: 'Limited reach', current: 'Expanded engagement', goal: 'Sustained engagement' },
  ],
  keyOutcomes: [
    { category: 'Engagement & Reach', insight: 'Reaching 25% more individuals in high-risk zones compared to previous quarter.', status: 'On Track', trend: '+25%' },
    { category: 'Service Delivery', insight: 'Implemented rapid response protocols for wound care and basic triage.', status: 'On Track', trend: 'Stable' },
    { category: 'Access to Care', insight: 'Improved coordination with local clinics to reduce barriers for uninsured patients.', status: 'Needs Attention', trend: '-5%' },
    { category: 'Systems Navigation', insight: 'Ensuring consistent follow-up for complex case management.', status: 'On Track', trend: '+12%' },
    { category: 'Partnerships & Capacity', insight: 'Collaborating with community organizations to expand resource reach.', status: 'At Risk', trend: 'Stalled' }
  ]
};

// --- 2. THE MAIN APP ---
export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [activeMapLayer, setActiveMapLayer] = useState('Patients');
  const [inventory, setInventory] = useState(MOCK_DATA.inventory);
  const [patients, setPatients] = useState(MOCK_DATA.patients);

  const handleAddPatient = (newPatient: any) => {
    setPatients(prev => [newPatient, ...prev]);
    setActiveTab('patients');
  };

  const handleOrder = (itemId: string) => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0] + ' ' + now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    
    setInventory(prev => prev.map(item => 
      item.id === itemId 
        ? { ...item, orderedAt: dateStr, orderedBy: 'Sarah Chen, RN' } 
        : item
    ));
  };

  const handleReceive = (itemId: string) => {
    setInventory(prev => prev.map(item => 
      item.id === itemId 
        ? { ...item, stock: Math.max(item.stock, item.min + 10), orderedAt: undefined, orderedBy: undefined } 
        : item
    ));
  };

  const handleNavigate = (tab: string, layer?: string) => {
    setActiveTab(tab);
    if (layer) setActiveMapLayer(layer);
    setSelectedPatientId(null);
  };

  // Simple navigation logic
  const renderContent = () => {
    if (selectedPatientId) return <PatientDetail id={selectedPatientId} patients={patients} onBack={() => setSelectedPatientId(null)} />;
    
    switch (activeTab) {
      case 'dashboard': return <HomeView onSelectPatient={setSelectedPatientId} onNavigate={handleNavigate} inventory={inventory} patients={patients} onOrder={handleOrder} onReceive={handleReceive} />;
      case 'patients': return <PatientsView onSelectPatient={setSelectedPatientId} patients={patients} onAddPatient={handleAddPatient} />;
      case 'map': return <MapView onSelectPatient={setSelectedPatientId} patients={patients} activeLayer={activeMapLayer} setActiveLayer={setActiveMapLayer} />;
      case 'inventory': return <InventoryView onNavigate={handleNavigate} inventory={inventory} onOrder={handleOrder} onReceive={handleReceive} />;
      case 'insights': return <InsightsView onNavigate={handleNavigate} />;
      case 'profile': return <ProfileView user={{ name: 'Sarah Chen, RN', role: 'Administrator', isAdmin: true, email: 's.chen@streetmed.org', agency: 'Street Medicine Detroit', team: 'Lead Outreach Council' }} onNavigate={handleNavigate} />;
      case 'management': return <MemberManagementView onBack={() => handleNavigate('profile')} />;
      default: return <HomeView onSelectPatient={setSelectedPatientId} onNavigate={handleNavigate} inventory={inventory} patients={patients} onOrder={handleOrder} onReceive={handleReceive} />;
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 font-sans max-w-md mx-auto border-x shadow-xl">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b p-4 flex items-center justify-between">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => handleNavigate('dashboard')}>
          <div className="bg-blue-600 text-white p-1.5 rounded-lg"><Stethoscope size={20} /></div>
          <h1 className="font-bold text-xl tracking-tight">Sineobex</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50/50">Team A</Badge>
          <button 
            onClick={() => setActiveTab('profile')}
            className={cn(
              "h-8 w-8 rounded-full border-2 shadow-sm flex items-center justify-center text-[10px] font-bold transition-all",
              activeTab === 'profile' ? "bg-blue-600 border-blue-600 text-white" : "bg-slate-200 border-white text-slate-600"
            )}
          >
            SC
          </button>
        </div>
      </header>

      {/* Content Area */}
      <main className="flex-1 p-4 pb-24 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab + (selectedPatientId || '')}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {renderContent()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 w-full max-w-md bg-white border-t flex justify-around p-2 pb-6">
        {[
          { id: 'dashboard', icon: Home, label: 'Dashboard' },
          { id: 'patients', icon: Users, label: 'Patients' },
          { id: 'map', icon: MapIcon, label: 'Map' },
          { id: 'inventory', icon: Package, label: 'Inventory' },
          { id: 'insights', icon: BarChart3, label: 'Insights' },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => { setActiveTab(item.id); setSelectedPatientId(null); }}
            className={cn(
              "flex flex-col items-center gap-1 p-2 transition-all",
              activeTab === item.id ? "text-blue-600 scale-110" : "text-slate-400"
            )}
          >
            <item.icon size={22} />
            <span className="text-[9px] font-bold uppercase">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// --- 3. FEATURE VIEWS (Simplified) ---

function HomeView({ onSelectPatient, onNavigate, inventory, patients, onOrder, onReceive }: { 
  onSelectPatient: (id: string) => void, 
  onNavigate: (tab: string, layer?: string) => void,
  inventory: any[],
  patients: any[],
  onOrder: (id: string) => void,
  onReceive: (id: string) => void
}) {
  const highRisk = patients.filter(p => p.risk === 'High');
  const followUps = patients.filter(p => p.followUp && p.risk !== 'High');
  const lowStock = inventory.filter(i => i.stock < i.min);
  const pendingTasks = MOCK_DATA.tasks.filter(t => t.status === 'pending');

  return (
    <div className="space-y-6">
      {/* Welcome & Summary Cards */}
      <section>
        <div className="flex justify-between items-end mb-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Coordination Hub</h2>
            <p className="text-slate-500 text-sm">Saturday, April 11 • Team A</p>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <Card className="bg-blue-600 text-white border-none shadow-blue-100 shadow-lg cursor-pointer" onClick={() => onNavigate('patients')}>
            <CardContent className="p-4">
              <div className="flex justify-between items-start">
                <Users size={20} className="opacity-80" />
                <Badge className="bg-white/20 text-white border-none text-[10px]">CARE</Badge>
              </div>
              <p className="text-3xl font-bold mt-2">{patients.length}</p>
              <p className="text-[10px] uppercase font-bold opacity-80 tracking-wider">Active Patients</p>
            </CardContent>
          </Card>
          <Card className="bg-white border-slate-200 cursor-pointer" onClick={() => onNavigate('map', 'Inventory')}>
            <CardContent className="p-4">
              <div className="flex justify-between items-start">
                <AlertCircle size={20} className="text-orange-500" />
                <Badge variant="outline" className="text-orange-600 border-orange-200 text-[10px]">{lowStock.length} Alerts</Badge>
              </div>
              <p className="text-3xl font-bold mt-2 text-slate-900">{lowStock.length}</p>
              <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Supply Alerts</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Module Shortcuts */}
      <section className="grid grid-cols-3 gap-2">
        <Button variant="outline" className="flex flex-col h-16 gap-1 rounded-2xl border-slate-100" onClick={() => onNavigate('map')}>
          <MapIcon size={18} className="text-blue-500" />
          <span className="text-[9px] font-bold uppercase">Map</span>
        </Button>
        <Button variant="outline" className="flex flex-col h-16 gap-1 rounded-2xl border-slate-100" onClick={() => onNavigate('insights')}>
          <BarChart3 size={18} className="text-purple-500" />
          <span className="text-[9px] font-bold uppercase">Insights</span>
        </Button>
        <Button variant="outline" className="flex flex-col h-16 gap-1 rounded-2xl border-slate-100" onClick={() => onNavigate('patients')}>
          <Calendar size={18} className="text-green-500" />
          <span className="text-[9px] font-bold uppercase">Alerts</span>
        </Button>
      </section>

      {/* Urgent / High Risk Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Urgent Attention</h3>
          <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">IMMEDIATE</span>
        </div>
        <div className="space-y-2">
          {highRisk.map(p => (
            <Card key={p.id} onClick={() => onSelectPatient(p.id)} className="border-l-4 border-l-red-500 cursor-pointer active:scale-[0.98] transition-all">
              <CardContent className="p-4 flex justify-between items-center">
                <div>
                  <p className="font-bold text-slate-900">{p.name}</p>
                  <p className="text-xs text-slate-500 flex items-center gap-1"><MapPin size={12} /> {p.loc}</p>
                </div>
                <div className="text-right">
                  <Badge className="bg-red-100 text-red-700 text-[9px] mb-1">HIGH RISK</Badge>
                  <p className="text-[10px] text-slate-400 font-medium">Needs Wound Care</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Map Preview */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Route Preview</h3>
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <div className="h-40 w-full relative cursor-pointer" onClick={() => onNavigate('map', 'Patients')}>
            <MapContainer 
              center={[42.3314, -83.0458]} 
              zoom={13} 
              style={{ height: '100%', width: '100%' }}
              zoomControl={false}
              dragging={false}
              touchZoom={false}
              scrollWheelZoom={false}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              />
              
              {/* Outreach Route (Dashed Orange Line) */}
              <Polyline 
                positions={[
                  [42.3314, -83.0458], 
                  [42.3350, -83.0500], 
                  [42.3400, -83.0580], 
                  [42.3450, -83.0600], 
                  [42.3480, -83.0750]
                ]}
                pathOptions={{ 
                  color: '#f97316', 
                  dashArray: '5, 5', 
                  weight: 2,
                  opacity: 0.4
                }}
              />

              {patients.map((p) => (
                <Marker 
                  key={p.id} 
                  position={[p.lat || 0, p.lng || 0]} 
                  icon={L.divIcon({
                    className: 'custom-pin-icon',
                    html: `
                      <div style="position: relative; width: 16px; height: 16px;">
                        <div style="background-color: ${p.risk === 'High' ? '#ef4444' : p.risk === 'Moderate' ? '#f59e0b' : '#3b82f6'}; width: 12px; height: 12px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); position: absolute; top: 0; left: 2px; border: 1px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);"></div>
                      </div>
                    `,
                    iconSize: [16, 16],
                    iconAnchor: [8, 16]
                  })}
                />
              ))}
            </MapContainer>
            <div className="absolute top-2 right-2 z-[1000] bg-white/90 backdrop-blur p-2 rounded-lg shadow-sm border border-slate-100 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-[8px] font-bold text-slate-600">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                High Risk
              </div>
              <div className="flex items-center gap-1.5 text-[8px] font-bold text-slate-600">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
                Moderate
              </div>
            </div>
          </div>
          <CardContent className="p-3 flex items-center justify-between bg-white">
            <p className="text-xs font-bold text-slate-700">{patients.length} Active Cases in Field</p>
            <Button variant="ghost" size="sm" className="h-6 text-[10px] font-bold text-blue-600" onClick={() => onNavigate('map')}>VIEW FULL MAP</Button>
          </CardContent>
        </Card>
      </section>

      {/* Tasks & Outreach Actions */}
      <section className="grid grid-cols-1 gap-4">
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Today's Actions</h3>
          <div className="space-y-2">
            {MOCK_DATA.outreachActions.map(action => (
              <div key={action.id} className="flex items-center gap-3 bg-white p-3 rounded-xl border border-slate-100">
                <div className="bg-slate-100 text-slate-600 p-2 rounded-lg font-bold text-[10px]">{action.time}</div>
                <div>
                  <p className="text-xs font-bold text-slate-900">{action.goal}</p>
                  <p className="text-[10px] text-slate-500">{action.location}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Team Tasks</h3>
          <Card>
            <CardContent className="p-0">
              {pendingTasks.map((task, i) => (
                <div key={task.id} className={cn(
                  "p-3 flex items-center gap-3",
                  i !== pendingTasks.length - 1 && "border-b border-slate-50"
                )}>
                  <div className="h-5 w-5 rounded border-2 border-slate-200" />
                  <div className="flex-1">
                    <p className="text-xs font-medium text-slate-700">{task.text}</p>
                  </div>
                  {task.priority === 'High' && <div className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Follow-ups & Inventory Alerts */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Pending Follow-ups</h3>
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {followUps.map(p => (
            <Card key={p.id} onClick={() => onSelectPatient(p.id)} className="min-w-[140px] flex-shrink-0 cursor-pointer">
              <CardContent className="p-3">
                <p className="text-xs font-bold text-slate-900 truncate">{p.name}</p>
                <p className="text-[10px] text-slate-500 truncate mb-2">{p.loc}</p>
                <Badge variant="secondary" className="text-[8px] bg-slate-100">Routine</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Inventory Alerts</h3>
        <div className="grid grid-cols-1 gap-2">
          {lowStock.map(item => (
            <div key={item.id} className="bg-orange-50 border border-orange-100 p-3 rounded-xl flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Package size={14} className="text-orange-600 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-orange-900 truncate">{item.name}</p>
                  <p className="text-[10px] text-orange-700">{item.stock} left</p>
                  {item.orderedAt ? (
                    <p className="text-[8px] text-blue-600 font-bold mt-1 leading-tight">
                      Ordered: {item.orderedAt} by {item.orderedBy}
                    </p>
                  ) : (
                    <p className="text-[8px] text-red-600 font-bold mt-1 uppercase tracking-tighter">
                      NEED TO ORDER
                    </p>
                  )}
                </div>
              </div>
              {item.orderedAt ? (
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="h-7 text-[8px] font-bold uppercase border-blue-200 text-blue-700 hover:bg-blue-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReceive(item.id);
                  }}
                >
                  Mark Received
                </Button>
              ) : (
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="h-7 text-[8px] font-bold uppercase border-orange-200 text-orange-700 hover:bg-orange-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOrder(item.id);
                  }}
                >
                  Mark Ordered
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PatientsView({ onSelectPatient, patients, onAddPatient }: { 
  onSelectPatient: (id: string) => void,
  patients: any[],
  onAddPatient: (patient: any) => void
}) {
  const [filter, setFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  
  // New patient state
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newInsuranceName, setNewInsuranceName] = useState('');
  const [newMemberId, setNewMemberId] = useState('');
  const [newPrimaryDoctor, setNewPrimaryDoctor] = useState('');
  const [newDob, setNewDob] = useState('');
  const [newLoc, setNewLoc] = useState('');
  const [newRisk, setNewRisk] = useState('Low');

  const handleSave = () => {
    if (!newFirstName || !newLastName || !newLoc) return;
    
    // Simple way to get age
    const birthYear = parseInt(newDob.split('-')[0]) || 1990;
    const age = new Date().getFullYear() - birthYear;

    const newPatient = {
      id: Math.random().toString(36).substr(2, 9),
      name: `${newFirstName} ${newLastName}`,
      firstName: newFirstName,
      lastName: newLastName,
      phone: newPhone,
      insuranceName: newInsuranceName,
      memberId: newMemberId,
      primaryDoctor: newPrimaryDoctor,
      age,
      dob: newDob || '1990-01-01',
      risk: newRisk,
      loc: newLoc,
      lat: 42.3314 + (Math.random() - 0.5) * 0.02, // Random near downtown
      lng: -83.0458 + (Math.random() - 0.5) * 0.02,
      tags: [],
      followUp: false,
      flags: [],
      commonLocations: [
        { 
          name: newLoc, 
          lat: 42.3314 + (Math.random() - 0.5) * 0.02, 
          lng: -83.0458 + (Math.random() - 0.5) * 0.02,
          date: new Date().toISOString().split('T')[0],
          day: new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date()),
          time: new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(new Date())
        }
      ],
      history: []
    };

    onAddPatient(newPatient);
    setIsAdding(false);
    setNewFirstName('');
    setNewLastName('');
    setNewPhone('');
    setNewInsuranceName('');
    setNewMemberId('');
    setNewPrimaryDoctor('');
    setNewDob('');
    setNewLoc('');
    setNewRisk('Low');
  };

  const filteredPatients = patients
    .filter(p => {
      // Search by name or DOB
      const matchesSearch = 
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (p.dob && p.dob.includes(searchQuery));
      
      if (!matchesSearch) return false;

      // Filter by Risk or Flags
      if (filter === 'All') return true;
      if (filter === 'High Risk') return p.risk === 'High';
      if (filter === 'Moderate Risk') return p.risk === 'Moderate';
      if (filter === 'Low Risk') return p.risk === 'Low';
      if (filter === 'Pregnancy') return p.flags.includes('Pregnancy');
      if (filter === 'Mental Health') return p.flags.includes('Mental Health');
      if (filter === 'Chronic') return p.flags.includes('Chronic Disease');
      return true;
    });

  if (isAdding) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setIsAdding(false)} className="-ml-2 text-slate-500">
          <ChevronLeft size={20} /> Cancel
        </Button>
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">New Patient Enrollment</h2>
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-400">First Name</label>
                  <Input value={newFirstName} onChange={e => setNewFirstName(e.target.value)} placeholder="Jane" className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-400">Last Name</label>
                  <Input value={newLastName} onChange={e => setNewLastName(e.target.value)} placeholder="Doe" className="rounded-xl" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-slate-400">Date of Birth</label>
                <Input type="date" value={newDob} onChange={e => setNewDob(e.target.value)} className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-slate-400">Phone Number</label>
                <Input type="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="(555) 000-0000" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-slate-400">Current/Found Location</label>
                <Input value={newLoc} onChange={e => setNewLoc(e.target.value)} placeholder="Cass Corridor" className="rounded-xl" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-400">Insurance Name</label>
                  <Input value={newInsuranceName} onChange={e => setNewInsuranceName(e.target.value)} placeholder="Blue Cross" className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-400">Member ID#</label>
                  <Input value={newMemberId} onChange={e => setNewMemberId(e.target.value)} placeholder="XYZ123456" className="rounded-xl" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-slate-400">Primary Doctor</label>
                <Input value={newPrimaryDoctor} onChange={e => setNewPrimaryDoctor(e.target.value)} placeholder="Dr. Smith" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-slate-400">Risk Assessment</label>
                <div className="flex gap-2">
                  {['Low', 'Moderate', 'High'].map(r => (
                    <Button 
                      key={r}
                      variant={newRisk === r ? 'default' : 'outline'}
                      size="sm"
                      className="flex-1 rounded-full text-[10px] font-bold h-8"
                      onClick={() => setNewRisk(r)}
                    >
                      {r}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
          <Button onClick={handleSave} className="w-full h-12 bg-blue-600 rounded-xl font-bold shadow-lg shadow-blue-100 flex gap-2">
            <Save size={18} /> Complete Enrollment
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Patient Care</h2>
        <Button size="icon" onClick={() => setIsAdding(true)} className="rounded-full bg-blue-600 shadow-md">
          <Plus size={20} />
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <Input 
          className="pl-10 h-12 rounded-2xl bg-white border-slate-200" 
          placeholder="Search by name or DOB (YYYY-MM-DD)..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {['All', 'High Risk', 'Moderate Risk', 'Low Risk', 'Pregnancy', 'Mental Health', 'Chronic'].map(f => (
          <Button 
            key={f} 
            variant={filter === f ? 'default' : 'outline'} 
            size="sm" 
            className="rounded-full whitespace-nowrap text-[10px] font-bold uppercase"
            onClick={() => setFilter(f)}
          >
            {f}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        {filteredPatients.map(p => (
          <Card key={p.id} onClick={() => onSelectPatient(p.id)} className="cursor-pointer hover:border-blue-200 transition-colors">
            <CardContent className="p-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-bold text-slate-900 text-lg">{p.name}</p>
                  <p className="text-xs text-slate-500">{p.age}y • DOB: {p.dob} • {p.loc}</p>
                </div>
                <Badge className={cn(
                  "text-[9px] uppercase font-bold",
                  p.risk === 'High' ? "bg-red-100 text-red-700" : 
                  p.risk === 'Moderate' ? "bg-orange-100 text-orange-700" : 
                  "bg-slate-100 text-slate-600"
                )}>{p.risk} Risk</Badge>
              </div>
              
              <div className="flex items-center justify-between mt-3">
                <div className="flex flex-wrap gap-1">
                  {p.flags.map(f => (
                    <Badge key={f} variant="outline" className="text-[8px] bg-blue-50 text-blue-600 border-blue-100">{f}</Badge>
                  ))}
                </div>
                {p.nextFollowUp && (
                  <div className="flex items-center gap-1 text-blue-600">
                    <Calendar size={12} />
                    <span className="text-[10px] font-bold uppercase">Next: {p.nextFollowUp}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FollowUpsView({ onSelectPatient, patients }: { onSelectPatient: (id: string) => void, patients: any[] }) {
  const followUps = patients.filter(p => p.followUp);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Follow-up Alerts</h2>
        <p className="text-slate-500 text-sm">Patients requiring outreach attention.</p>
      </div>

      <div className="space-y-4">
        {followUps.map(p => (
          <Card key={p.id} onClick={() => onSelectPatient(p.id)} className="cursor-pointer border-l-4 border-l-blue-500">
            <CardContent className="p-4 flex justify-between items-center">
              <div className="flex gap-3">
                <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                  <Calendar size={20} />
                </div>
                <div>
                  <p className="font-bold text-slate-900">{p.name}</p>
                  <p className="text-xs text-slate-500 flex items-center gap-1"><MapPin size={12} /> {p.loc}</p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="text-[10px] font-bold uppercase">View Chart</Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-slate-900 text-white border-none">
        <CardContent className="p-6 text-center">
          <p className="text-sm opacity-70 mb-2 uppercase tracking-widest font-bold">Team Reminder</p>
          <p className="text-lg font-medium">Ensure all follow-ups are documented before shift end at 18:00.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function PatientDetail({ id, patients, onBack }: { id: string, patients: any[], onBack: () => void }) {
  const p = patients.find(x => x.id === id);
  const [isLogging, setIsLogging] = useState(false);
  const [notes, setNotes] = useState('');
  const [needsFollowUp, setNeedsFollowUp] = useState(false);
  const [selectedSupplies, setSelectedSupplies] = useState<string[]>([]);

  const toggleSupply = (name: string) => {
    setSelectedSupplies(prev => 
      prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]
    );
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={onBack} className="-ml-2 text-slate-500"><ChevronLeft size={20} /> Back to Care</Button>
      
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-3xl font-bold">{p?.name}</h2>
          <p className="text-slate-500 font-medium">{p?.age}y • DOB: {p?.dob} • {p?.loc}</p>
          {p?.nextFollowUp && (
            <div className="flex items-center gap-1 text-blue-600 mt-1">
              <Calendar size={14} />
              <span className="text-xs font-bold uppercase">Next Follow-up: {p.nextFollowUp}</span>
            </div>
          )}
        </div>
        <Badge className={cn(
          "text-xs uppercase font-bold px-3 py-1",
          p?.risk === 'High' ? "bg-red-100 text-red-700" : 
          p?.risk === 'Moderate' ? "bg-orange-100 text-orange-700" :
          "bg-slate-100 text-slate-600"
        )}>{p?.risk} Risk</Badge>
      </div>

      {/* Flags Section */}
      <div className="flex flex-wrap gap-2">
        {p?.flags.map(f => (
          <Badge key={f} className="bg-blue-600 text-white border-none text-[10px] px-2 py-0.5">
            {f === 'Pregnancy' && '🤰 '}
            {f === 'Mental Health' && '🧠 '}
            {f === 'Chronic Disease' && '🏥 '}
            {f}
          </Badge>
        ))}
      </div>

      {/* Common Locations Map */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest flex items-center gap-2">
          <MapIcon size={14} /> Field Intelligence Map
        </h3>
        <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
          <div className="h-56 w-full relative">
            <MapContainer 
              center={[p?.lat || 42.3314, p?.lng || -83.0458]} 
              zoom={15} 
              style={{ height: '100%', width: '100%' }}
              zoomControl={false}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              />
              
              {/* Primary Patient Location (Risk Colored) */}
              {p && (
                <Marker 
                  position={[p.lat, p.lng]}
                  icon={L.divIcon({
                    className: 'custom-pin-icon',
                    html: `
                      <div style="position: relative; width: 24px; height: 24px;">
                        <div style="background-color: ${p.risk === 'High' ? '#ef4444' : p.risk === 'Moderate' ? '#f59e0b' : '#3b82f6'}; width: 20px; height: 20px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); position: absolute; top: 0; left: 2px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>
                        <div style="background-color: white; width: 8px; height: 8px; border-radius: 50%; position: absolute; top: 6px; left: 8px;"></div>
                      </div>
                    `,
                    iconSize: [24, 24],
                    iconAnchor: [12, 24]
                  })}
                >
                  <Popup>Current: {p.loc}</Popup>
                </Marker>
              )}

              {/* Common Locations (Blue Pins) */}
              {p?.commonLocations?.map((loc, idx) => (
                <Marker 
                  key={idx} 
                  position={[loc.lat, loc.lng]}
                  icon={L.divIcon({
                    className: 'common-loc-pin',
                    html: `
                      <div style="position: relative; width: 18px; height: 18px;">
                        <div style="background-color: #64748b; width: 14px; height: 14px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); position: absolute; top: 0; left: 2px; border: 1.5px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);"></div>
                        <div style="background-color: white; width: 4px; height: 4px; border-radius: 50%; position: absolute; top: 5px; left: 7px;"></div>
                      </div>
                    `,
                    iconSize: [18, 18],
                    iconAnchor: [9, 18]
                  })}
                >
                  <Popup>{loc.name}</Popup>
                </Marker>
              ))}
            </MapContainer>
            
            {/* Legend Overlay */}
            <div className="absolute top-2 right-2 flex flex-col gap-1">
              <div className="bg-white/90 backdrop-blur px-2 py-1 rounded-lg text-[8px] font-bold border border-slate-200 shadow-sm flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p?.risk === 'High' ? '#ef4444' : p?.risk === 'Moderate' ? '#f59e0b' : '#3b82f6' }}></div>
                Current Location
              </div>
              <div className="bg-white/90 backdrop-blur px-2 py-1 rounded-lg text-[8px] font-bold border border-slate-200 shadow-sm flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-slate-500"></div>
                Common Hubs
              </div>
            </div>

            <div className="absolute bottom-2 left-2 right-2 flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
              {p?.commonLocations?.map((loc, idx) => (
                <div key={idx} className="bg-white/90 backdrop-blur px-2 py-1.5 rounded-lg text-[9px] font-bold border border-slate-200 whitespace-nowrap shadow-sm text-slate-600 flex flex-col">
                  <span>{loc.name}</span>
                  <span className="text-[7px] text-slate-400 font-medium">{loc.day}, {loc.date} • {loc.time}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Movement Patterns List */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest flex items-center gap-2">
          <Clock size={14} /> Historical Movement Patterns
        </h3>
        <div className="space-y-2">
          {p?.commonLocations?.map((loc, idx) => (
            <div key={idx} className="bg-white p-3 rounded-xl border border-slate-100 flex items-center gap-3">
              <div className="bg-slate-50 p-2 rounded-lg text-slate-400">
                <MapPin size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-900 truncate">{loc.name}</p>
                <p className="text-[10px] text-slate-500">{loc.day}, {loc.date} • {loc.time}</p>
              </div>
              <Badge variant="outline" className="text-[8px] uppercase font-bold text-blue-600 border-blue-100 bg-blue-50/30">Verified</Badge>
            </div>
          ))}
        </div>
        <p className="text-[9px] text-slate-400 italic px-1">Movement patterns help predict patient location for future outreach follow-ups.</p>
      </section>

      {/* Demographics & Billing */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest flex items-center gap-2">
          <Info size={14} /> Demographics & Billing
        </h3>
        <Card className="border-slate-200">
          <CardContent className="p-4 grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase text-slate-400">Insurance Name</p>
              <p className="text-sm font-medium text-slate-900">{p?.insuranceName || 'Self-Pay / Not Provided'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase text-slate-400">Member ID#</p>
              <p className="text-sm font-medium text-slate-900">{p?.memberId || 'N/A'}</p>
            </div>
            <div className="space-y-1 border-t border-slate-50 pt-3">
              <p className="text-[10px] font-bold uppercase text-slate-400">Primary Doctor</p>
              <p className="text-sm font-medium text-slate-900">{p?.primaryDoctor || 'None Assigned'}</p>
            </div>
            <div className="space-y-1 border-t border-slate-50 pt-3">
              <p className="text-[10px] font-bold uppercase text-slate-400">Phone Number</p>
              <p className="text-sm font-medium text-slate-900">{p?.phone || 'No Phone'}</p>
            </div>
          </CardContent>
        </Card>
      </section>

      {!isLogging ? (
        <Button onClick={() => setIsLogging(true)} className="w-full h-14 bg-blue-600 text-lg font-bold rounded-2xl shadow-lg shadow-blue-100 flex gap-2">
          <Stethoscope size={20} />
          Log New Encounter
        </Button>
      ) : (
        <Card className="border-blue-200 bg-blue-50/30 ring-2 ring-blue-100">
          <CardContent className="p-4 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-blue-900">New Field Entry</h3>
              <p className="text-[10px] font-bold text-blue-600 uppercase">By: {MOCK_DATA.currentUser.name}</p>
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase text-slate-400">Encounter Notes</label>
              <Textarea 
                placeholder="Document findings, treatments, and immediate needs..." 
                className="bg-white min-h-[120px] text-sm" 
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase text-slate-400">Supplies Used</label>
              <div className="flex flex-wrap gap-2">
                {MOCK_DATA.inventory.slice(0, 4).map(item => (
                  <Button 
                    key={item.id} 
                    variant={selectedSupplies.includes(item.name) ? 'default' : 'outline'}
                    size="sm"
                    className="text-[10px] h-8 rounded-full"
                    onClick={() => toggleSupply(item.name)}
                  >
                    {item.name}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 bg-white p-3 rounded-xl border border-blue-100">
              <input 
                type="checkbox" 
                id="followup" 
                className="h-4 w-4 rounded border-slate-300"
                checked={needsFollowUp}
                onChange={(e) => setNeedsFollowUp(e.target.checked)}
              />
              <label htmlFor="followup" className="text-xs font-bold text-slate-700">Flag for Follow-up</label>
            </div>

            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setIsLogging(false)}>Cancel</Button>
              <Button className="flex-1 bg-blue-600 gap-2" onClick={() => setIsLogging(false)}>
                <Save size={16} /> Save Entry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest flex items-center gap-2">
          <HistoryIcon size={14} /> Encounter History
        </h3>
        <div className="space-y-3 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
          {p?.history.map(h => (
            <div key={h.id} className="relative pl-8">
              <div className="absolute left-2 top-2 h-2 w-2 rounded-full bg-blue-500 border-2 border-white" />
              <Card>
                <CardContent className="p-4">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-[10px] font-bold text-slate-900 uppercase">{h.provider}</p>
                    <p className="text-[10px] text-slate-400">{h.date}</p>
                  </div>
                  <div className="mb-2 flex items-center gap-1">
                    <MapPin size={10} className="text-slate-400" />
                    <p className="text-[10px] font-medium text-slate-500">{h.encounterLoc || 'Field Location'}</p>
                  </div>
                  <div className="mb-2">
                    <p className="text-[10px] font-bold text-blue-600 uppercase mb-1">Needs Addressed</p>
                    <p className="text-xs font-medium text-slate-800">{h.needs}</p>
                  </div>
                  <div className="mb-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Clinical Notes</p>
                    <p className="text-sm text-slate-600 leading-relaxed">{h.notes}</p>
                  </div>
                  {h.supplies && (
                    <div className="mb-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Materials Provided</p>
                      <div className="flex flex-wrap gap-1">
                        {h.supplies.map(s => (
                          <Badge key={s} variant="secondary" className="text-[8px] bg-slate-100 text-slate-500 border-none">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {h.followUpSet && (
                    <div className="bg-blue-50 p-2 rounded-lg border border-blue-100">
                      <p className="text-[9px] font-bold text-blue-600 uppercase mb-1 flex items-center gap-1">
                        <Calendar size={10} /> Scheduled Follow-up
                      </p>
                      <div className="flex justify-between text-[10px]">
                        <span className="font-bold text-blue-900">{h.followUpDate}</span>
                        <span className="text-blue-700 flex items-center gap-1"><MapPin size={10} /> {h.followUpLoc}</span>
                      </div>
                    </div>
                  )}
                  {h.followUpSet && (
                    <Badge variant="outline" className="mt-1 text-[8px] border-blue-200 text-blue-600 bg-blue-50">Follow-up Required</Badge>
                  )}
                </CardContent>
              </Card>
            </div>
          ))}
          {p?.history.length === 0 && (
            <p className="text-xs text-slate-400 italic pl-8">No previous encounters documented.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function MapView({ onSelectPatient, patients, activeLayer, setActiveLayer }: { 
  onSelectPatient: (id: string) => void, 
  patients: any[],
  activeLayer: string, 
  setActiveLayer: (layer: string) => void 
}) {
  const detroitCenter: [number, number] = [42.3314, -83.0458];

  // Custom Pin Icons for Risk Levels (matching the image)
  const getRiskIcon = (risk: string) => {
    let color = '#3b82f6'; // Low (Blue)
    if (risk === 'Moderate') color = '#f59e0b'; // Moderate (Yellow/Orange)
    if (risk === 'High') color = '#ef4444'; // High (Red)

    return L.divIcon({
      className: 'custom-pin-icon',
      html: `
        <div style="position: relative; width: 20px; height: 20px;">
          <div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); position: absolute; top: 0; left: 2px; border: 1px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></div>
          <div style="background-color: white; width: 6px; height: 6px; border-radius: 50%; position: absolute; top: 5px; left: 7px;"></div>
        </div>
      `,
      iconSize: [20, 20],
      iconAnchor: [10, 20]
    });
  };

  // Custom Resource Icons (matching the image)
  const getResourceIcon = (type: string) => {
    let emoji = '📍';
    let color = '#10b981'; // Default Green (Clinics/Shelters)
    let iconBg = '#dcfce7';

    switch (type) {
      case 'Shelter': emoji = '🏠'; color = '#10b981'; iconBg = '#dcfce7'; break;
      case 'Hospital': emoji = '🏥'; color = '#10b981'; iconBg = '#dcfce7'; break;
      case 'Soup Kitchen': emoji = '🍲'; color = '#3b82f6'; iconBg = '#dbeafe'; break;
      case 'Pharmacy': emoji = '💊'; color = '#3b82f6'; iconBg = '#dbeafe'; break;
      case 'Dental': emoji = '🦷'; color = '#3b82f6'; iconBg = '#dbeafe'; break;
      case 'Restroom': emoji = '🚻'; color = '#3b82f6'; iconBg = '#dbeafe'; break;
      default: emoji = '📍'; color = '#10b981';
    }

    return L.divIcon({
      className: 'custom-resource-icon',
      html: `<div style="background-color: ${iconBg}; width: 24px; height: 24px; border-radius: 50%; border: 2px solid ${color}; display: flex; align-items: center; justify-content: center; font-size: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">${emoji}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  };

  const layers = ['Patients', 'Resources', 'Heatmap', 'Inventory'];

  // Mock Route Coordinates (Detroit specific)
  const routes: Record<string, [number, number][]> = {
    Patients: [
      [42.3314, -83.0458], // Downtown
      [42.3350, -83.0500], // Grand Circus
      [42.3400, -83.0580], // Cass Park
      [42.3450, -83.0600], // Cass Corridor
      [42.3480, -83.0750], // Covenant House
    ],
    Resources: [
      [42.3415, -83.0550], // Detroit Rescue Mission
      [42.3480, -83.0750], // Covenant House
      [42.3655, -83.0845], // COTS
      [42.3670, -83.0850], // Henry Ford
    ],
    Heatmap: [
      [42.3450, -83.0600], // Cass Corridor
      [42.3380, -83.0450], // I-75
      [42.3680, -83.0750], // New Center
      [42.3150, -83.1000], // Southwest
    ],
    Inventory: [
      [42.3410, -83.0590], // Cass Park
      [42.3280, -83.0440], // Hart Plaza
      [42.3370, -83.0510], // Grand Circus
      [42.3695, -83.0770], // New Center
    ]
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Field Map: {activeLayer}</h2>
        <div className="flex gap-1 bg-slate-100 p-1 rounded-full">
          {layers.map(l => (
            <button
              key={l}
              onClick={() => setActiveLayer(l)}
              className={cn(
                "px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-all",
                activeLayer === l ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Real Map Area - Light Theme */}
      <div className="relative border border-slate-200 shadow-2xl rounded-[2rem] h-[550px] overflow-hidden z-0">
        <MapContainer 
          center={detroitCenter} 
          zoom={14} 
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
        >
          {/* Light Theme Tiles (CartoDB Positron) */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          
          {/* Outreach Route (Dashed Orange Line) */}
          <Polyline 
            positions={routes[activeLayer] || []}
            pathOptions={{ 
              color: activeLayer === 'Resources' ? '#10b981' : activeLayer === 'Inventory' ? '#8b5cf6' : '#f97316', 
              dashArray: '10, 10', 
              weight: 3,
              opacity: 0.6
            }}
          />

          {/* Patient Markers (Pins) */}
          {activeLayer === 'Patients' && patients.map((p) => (
            <Marker 
              key={p.id} 
              position={[p.lat || 0, p.lng || 0]} 
              icon={getRiskIcon(p.risk)}
            >
              <Popup>
                <div className="p-1">
                  <button 
                    onClick={() => onSelectPatient(p.id)}
                    className="font-bold text-sm text-blue-600 hover:underline text-left block w-full"
                  >
                    {p.name}
                  </button>
                  <p className="text-[10px] text-slate-500">{p.loc}</p>
                  <Badge className={cn("mt-1 text-[8px]", p.risk === 'High' ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600")}>
                    {p.risk} Risk
                  </Badge>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Resource Markers (Circles) */}
          {activeLayer === 'Resources' && MOCK_DATA.resources.map((r) => (
            <Marker 
              key={r.id} 
              position={[r.lat || 0, r.lng || 0]} 
              icon={getResourceIcon(r.type)}
            >
              <Popup>
                <div className="p-2 min-w-[150px]">
                  <p className="font-bold text-sm mb-1">{r.name}</p>
                  <div className="space-y-1 text-[10px] text-slate-600">
                    <p className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      {r.loc}
                    </p>
                    <p className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      {r.hours}
                    </p>
                    <p className="flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 text-slate-400" />
                      {r.phone}
                    </p>
                  </div>
                  <Badge className="mt-2 text-[8px] bg-blue-50 text-blue-600 border-none">
                    {r.type}
                  </Badge>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Heatmap Simulation (Categorized Clouds) */}
          {activeLayer === 'Heatmap' && MOCK_DATA.hotspots.filter(h => h.type !== 'Supply Usage').map((h) => {
            let color = '#ef4444'; // Default Red
            let badgeClass = "bg-red-100 text-red-600";

            if (h.type === 'Rising Need') {
              color = '#eab308'; // Yellow
              badgeClass = "bg-yellow-100 text-yellow-700";
            } else if (h.type === 'Food Desert') {
              color = '#22c55e'; // Green
              badgeClass = "bg-green-100 text-green-700";
            } else if (h.type === 'Pharmacy Desert') {
              color = '#3b82f6'; // Blue
              badgeClass = "bg-blue-100 text-blue-600";
            }

            const baseRadius = h.intensity === 'High' ? 700 : 400;

            return (
              <React.Fragment key={h.id}>
                <Circle
                  center={[h.lat || 0, h.lng || 0]}
                  radius={baseRadius * 1.2}
                  pathOptions={{ 
                    fillColor: color,
                    color: 'transparent',
                    fillOpacity: 0.08
                  }}
                  interactive={false}
                />
                <Circle
                  center={[h.lat || 0, h.lng || 0]}
                  radius={baseRadius * 0.8}
                  pathOptions={{ 
                    fillColor: color,
                    color: 'transparent',
                    fillOpacity: 0.12
                  }}
                  interactive={false}
                />
                <Circle
                  center={[h.lat || 0, h.lng || 0]}
                  radius={baseRadius * 0.4}
                  pathOptions={{ 
                    fillColor: color,
                    color: 'transparent',
                    fillOpacity: 0.2
                  }}
                >
                  <Popup>
                    <div className="p-1">
                      <p className="font-bold text-sm">{h.name}</p>
                      <Badge className={cn("text-[8px] mb-1 border-none", badgeClass)} variant="outline">{h.type}</Badge>
                    </div>
                  </Popup>
                </Circle>
              </React.Fragment>
            );
          })}

          {/* Inventory Layer (Supply Usage) */}
          {activeLayer === 'Inventory' && MOCK_DATA.hotspots.filter(h => h.type === 'Supply Usage').map((h) => {
            const color = '#8b5cf6'; // Purple
            const badgeClass = "bg-purple-100 text-purple-600";
            const baseRadius = h.intensity === 'High' ? 700 : 400;

            return (
              <React.Fragment key={h.id}>
                <Circle
                  center={[h.lat || 0, h.lng || 0]}
                  radius={baseRadius * 1.2}
                  pathOptions={{ 
                    fillColor: color,
                    color: 'transparent',
                    fillOpacity: 0.08
                  }}
                  interactive={false}
                />
                <Circle
                  center={[h.lat || 0, h.lng || 0]}
                  radius={baseRadius * 0.8}
                  pathOptions={{ 
                    fillColor: color,
                    color: 'transparent',
                    fillOpacity: 0.12
                  }}
                  interactive={false}
                />
                <Circle
                  center={[h.lat || 0, h.lng || 0]}
                  radius={baseRadius * 0.4}
                  pathOptions={{ 
                    fillColor: color,
                    color: 'transparent',
                    fillOpacity: 0.2
                  }}
                >
                  <Popup>
                    <div className="p-1">
                      <p className="font-bold text-sm">{h.name}</p>
                      <Badge className={cn("text-[8px] mb-1 border-none", badgeClass)} variant="outline">Supply Usage</Badge>
                      {h.supply && (
                        <p className="text-[10px] text-slate-500 mt-1 font-medium">
                          Item: {h.supply}
                        </p>
                      )}
                    </div>
                  </Popup>
                </Circle>
              </React.Fragment>
            );
          })}
        </MapContainer>

        {/* Legend (Matching the image style) */}
        <div className="absolute bottom-6 right-6 z-[1000] bg-white p-4 rounded-xl shadow-2xl border border-slate-100 min-w-[160px] space-y-4">
          {activeLayer === 'Patients' && (
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Risk Level</p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-[10px] font-medium text-slate-600">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500"></div>
                  <span>Low</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-medium text-slate-600">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500"></div>
                  <span>Moderate</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-medium text-slate-600">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                  <span>High</span>
                </div>
              </div>
            </div>
          )}

          {activeLayer === 'Resources' && (
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Resources</p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-[10px] font-medium text-slate-600">
                  <div className="w-4 h-4 rounded-full bg-green-100 border border-green-500 flex items-center justify-center text-[8px]">🏠</div>
                  <span>Shelters</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-medium text-slate-600">
                  <div className="w-4 h-4 rounded-full bg-green-100 border border-green-500 flex items-center justify-center text-[8px]">🏥</div>
                  <span>Clinics</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-medium text-slate-600">
                  <div className="w-4 h-4 rounded-full bg-blue-100 border border-blue-500 flex items-center justify-center text-[8px]">💊</div>
                  <span>Services</span>
                </div>
              </div>
            </div>
          )}

          {activeLayer === 'Heatmap' && (
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Heatmap</p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-[10px] font-medium text-slate-600">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/40"></div>
                  <span>Infectious Disease</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-medium text-slate-600">
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40"></div>
                  <span>Rising Needs</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-medium text-slate-600">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/40"></div>
                  <span>Food Desert</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-medium text-slate-600">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500/40"></div>
                  <span>Pharmacy Desert</span>
                </div>
              </div>
            </div>
          )}

          {activeLayer === 'Inventory' && (
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Inventory</p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-[10px] font-medium text-slate-600">
                  <div className="w-2.5 h-2.5 rounded-full bg-purple-500/40"></div>
                  <span>Supply Usage</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Map Controls & Insights */}
      {activeLayer === 'Patients' && (
        <>
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Route Planning</h3>
            <Card className="bg-blue-600 text-white border-none">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 p-2 rounded-lg"><Navigation size={20} /></div>
                  <div>
                    <p className="text-xs font-bold">Patient Outreach Route</p>
                    <p className="text-[10px] opacity-80">5 Patients • 1.4 miles • 3h est.</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 text-[10px] font-bold">START</Button>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Priority Patients in Area</h3>
            <div className="grid grid-cols-1 gap-2">
              {MOCK_DATA.patients.slice(0, 4).map(p => (
                <div key={p.id} onClick={() => onSelectPatient(p.id)} className="bg-white p-3 rounded-xl border border-slate-100 flex justify-between items-center cursor-pointer hover:border-blue-200 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      p.risk === 'High' ? "bg-red-500" : "bg-orange-500"
                    )} />
                    <div>
                      <p className="text-xs font-bold text-slate-900">{p.name}</p>
                      <p className="text-[10px] text-slate-500">{p.loc}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[8px] uppercase font-bold">{p.risk} Risk</Badge>
                </div>
              ))}
            </div>
          </section>

          <Card className="bg-blue-50 border-blue-100">
            <CardContent className="p-4 flex gap-3">
              <div className="bg-blue-600 text-white p-2 rounded-lg h-fit"><AlertCircle size={16} /></div>
              <div>
                <p className="text-xs font-bold text-blue-900">Clinical Insight</p>
                <p className="text-[10px] text-blue-700 leading-relaxed">High concentration of wound care needs in **Cass Corridor**. Ensure Van 1 is stocked with extra silver sulfadiazine.</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {activeLayer === 'Resources' && (
        <>
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Resource Logistics</h3>
            <Card className="bg-green-600 text-white border-none">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 p-2 rounded-lg"><Home size={20} /></div>
                  <div>
                    <p className="text-xs font-bold">Shelter Referral Loop</p>
                    <p className="text-[10px] opacity-80">3 Partners • Bed availability check</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 text-[10px] font-bold">SYNC</Button>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Nearby Partner Facilities</h3>
            <div className="grid grid-cols-1 gap-2">
              {MOCK_DATA.resources.slice(0, 4).map(r => (
                <div key={r.id} className="bg-white p-3 rounded-xl border border-slate-100 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-xs border border-green-100">
                      {r.type === 'Shelter' ? '🏠' : r.type === 'Hospital' ? '🏥' : '💊'}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">{r.name}</p>
                      <p className="text-[10px] text-slate-50">{r.hours}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[8px] uppercase font-bold text-green-600 border-green-200">{r.type}</Badge>
                </div>
              ))}
            </div>
          </section>

          <Card className="bg-green-50 border-green-100">
            <CardContent className="p-4 flex gap-3">
              <div className="bg-green-600 text-white p-2 rounded-lg h-fit"><Info size={16} /></div>
              <div>
                <p className="text-xs font-bold text-green-900">Resource Insight</p>
                <p className="text-[10px] text-green-700 leading-relaxed">Pharmacy desert identified in **Delray**; nearest partner is 1.2 miles away. Consider mobile pharmacy stop on Tuesday.</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {activeLayer === 'Heatmap' && (
        <>
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Epidemiology Route</h3>
            <Card className="bg-amber-600 text-white border-none">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 p-2 rounded-lg"><TrendingUp size={20} /></div>
                  <div>
                    <p className="text-xs font-bold">Outbreak Surveillance</p>
                    <p className="text-[10px] opacity-80">3 Clusters • Screening focus</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 text-[10px] font-bold">VIEW</Button>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Health Risk Hotspots</h3>
            <div className="grid grid-cols-1 gap-2">
              {MOCK_DATA.hotspots.filter(h => h.type !== 'Supply Usage').slice(0, 4).map(h => (
                <div key={h.id} className="bg-white p-3 rounded-xl border border-slate-100 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      h.type === 'COVID-19' || h.type === 'Hepatitis C' ? "bg-red-500" : "bg-amber-500"
                    )} />
                    <div>
                      <p className="text-xs font-bold text-slate-900">{h.name}</p>
                      <p className="text-[10px] text-slate-500">{h.type}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[8px] uppercase font-bold">{h.intensity} Risk</Badge>
                </div>
              ))}
            </div>
          </section>

          <Card className="bg-orange-50 border-orange-100">
            <CardContent className="p-4 flex gap-3">
              <div className="bg-orange-600 text-white p-2 rounded-lg h-fit"><AlertCircle size={16} /></div>
              <div>
                <p className="text-xs font-bold text-orange-900">Strategic Insight</p>
                <p className="text-[10px] text-orange-700 leading-relaxed">Rising cluster detected near **Michigan & Trumbull**. No partner services within 0.5 miles. Recommend adding a water drop-off point.</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {activeLayer === 'Inventory' && (
        <>
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Supply Logistics</h3>
            <Card className="bg-purple-600 text-white border-none">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 p-2 rounded-lg"><Package size={20} /></div>
                  <div>
                    <p className="text-xs font-bold">Restock Route</p>
                    <p className="text-[10px] opacity-80">6 Items • Van 2 Optimization</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 text-[10px] font-bold">RESTOCK</Button>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Supply Distribution Points</h3>
            <div className="grid grid-cols-1 gap-2">
              {MOCK_DATA.hotspots.filter(h => h.type === 'Supply Usage').slice(0, 4).map(h => (
                <div key={h.id} className="bg-white p-3 rounded-xl border border-slate-100 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-purple-500" />
                    <div>
                      <p className="text-xs font-bold text-slate-900">{h.name}</p>
                      <p className="text-[10px] text-slate-500">Item: {h.supply}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[8px] uppercase font-bold text-purple-600 border-purple-200">{h.intensity} Usage</Badge>
                </div>
              ))}
            </div>
          </section>

          <Card className="bg-purple-50 border-purple-100">
            <CardContent className="p-4 flex gap-3">
              <div className="bg-purple-600 text-white p-2 rounded-lg h-fit"><TrendingUp size={16} /></div>
              <div>
                <p className="text-xs font-bold text-purple-900">Inventory Insight</p>
                <p className="text-[10px] text-purple-700 leading-relaxed">Narcan usage is 40% higher than average in **Hart Plaza** this week. Recommend shifting 20% of inventory to Van 2 for this route.</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <div className="p-4 text-center">
        <p className="text-[10px] text-slate-400 italic">Placeholder: In production, this would integrate with Mapbox or Google Maps API for real-time GPS tracking in Detroit.</p>
      </div>
    </div>
  );
}

function InventoryView({ onNavigate, inventory, onOrder, onReceive }: { 
  onNavigate: (tab: string, layer?: string) => void,
  inventory: any[],
  onOrder: (id: string) => void,
  onReceive: (id: string) => void
}) {
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  
  const categories = ['All', 'Medical', 'Essentials', 'Clothing'];
  const statuses = [
    { id: 'All', label: 'All' },
    { id: 'Low', label: 'Low Stock' },
    { id: 'Out', label: 'Out of Stock' },
    { id: 'In', label: 'In Stock' }
  ];
  
  const filteredInventory = inventory.filter(item => {
    const matchesCategory = categoryFilter === 'All' || item.category === categoryFilter;
    
    let matchesStatus = true;
    if (statusFilter === 'Low') matchesStatus = item.stock > 0 && item.stock < item.min;
    if (statusFilter === 'Out') matchesStatus = item.stock === 0;
    if (statusFilter === 'In') matchesStatus = item.stock >= item.min;
    
    return matchesCategory && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Inventory</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-[10px] font-bold uppercase border-purple-200 text-purple-600" onClick={() => onNavigate('map', 'Inventory')}>
            <MapIcon size={14} className="mr-1" /> View Map
          </Button>
          <Button size="icon" className="h-8 w-8 rounded-full bg-blue-600"><Plus size={16} /></Button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Category</p>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {categories.map(c => (
              <Button 
                key={c} 
                variant={categoryFilter === c ? 'default' : 'outline'} 
                size="sm" 
                className="rounded-full whitespace-nowrap text-[10px] font-bold uppercase h-7"
                onClick={() => setCategoryFilter(c)}
              >
                {c}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Stock Status</p>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {statuses.map(s => (
              <Button 
                key={s.id} 
                variant={statusFilter === s.id ? 'secondary' : 'outline'} 
                size="sm" 
                className={cn(
                  "rounded-full whitespace-nowrap text-[10px] font-bold uppercase h-7",
                  statusFilter === s.id && "bg-blue-100 text-blue-700 border-blue-200"
                )}
                onClick={() => setStatusFilter(s.id)}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {filteredInventory.map(item => {
          const isLow = item.stock < item.min;
          const isOutOfStock = item.stock === 0;
          const percentage = Math.min(100, (item.stock / (item.min * 1.5)) * 100);
          
          const currentMonthDemand = MOCK_DATA.seasonalDemand.find(d => d.month === 'Apr')?.items || [];
          const isSeasonalPriority = currentMonthDemand.some(dItem => item.name.toLowerCase().includes(dItem.toLowerCase()));

          return (
            <Card key={item.id} className={cn(
              "overflow-hidden transition-all",
              isOutOfStock ? "border-red-200 bg-red-50/20" : 
              isLow ? "border-orange-200 bg-orange-50/20" : 
              isSeasonalPriority ? "border-blue-200 bg-blue-50/20" : "border-slate-100"
            )}>
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-900">{item.name}</p>
                      {isOutOfStock ? (
                        <Badge className="bg-red-100 text-red-700 text-[8px] h-4">OUT OF STOCK</Badge>
                      ) : isLow ? (
                        <Badge className="bg-orange-100 text-orange-700 text-[8px] h-4">LOW STOCK</Badge>
                      ) : isSeasonalPriority && (
                        <Badge className="bg-blue-100 text-blue-700 text-[8px] h-4">SEASONAL PRIORITY</Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 uppercase font-bold">{item.category}</p>
                  </div>
                  <div className="text-right">
                    <p className={cn(
                      "text-xl font-bold", 
                      isOutOfStock ? "text-red-600" :
                      isLow ? "text-orange-600" : "text-slate-900"
                    )}>
                      {item.stock}
                    </p>
                    <p className="text-[10px] text-slate-400 uppercase">{item.unit}</p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className={cn(
                          "h-full rounded-full transition-all duration-500", 
                          isOutOfStock ? "bg-red-500" :
                          isLow ? "bg-orange-500" : "bg-blue-500"
                        )} 
                        style={{ width: `${percentage}%` }} 
                      />
                    </div>
                    <div className="flex justify-between text-[8px] font-bold text-slate-400 uppercase">
                      <span>0</span>
                      <span>Min: {item.min}</span>
                    </div>
                  </div>

                  {(isLow || isOutOfStock) && (
                    <div className="bg-white/50 p-2 rounded-lg border border-slate-100 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-[9px] font-bold text-slate-500 uppercase">
                          <Clock size={10} /> Order Status
                        </div>
                        {item.orderedAt ? (
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-5 px-2 text-[8px] font-bold uppercase text-green-600 hover:bg-green-50"
                            onClick={() => onReceive(item.id)}
                          >
                            Mark Received
                          </Button>
                        ) : (
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-5 px-2 text-[8px] font-bold uppercase text-blue-600 hover:bg-blue-50"
                            onClick={() => onOrder(item.id)}
                          >
                            Mark Ordered
                          </Button>
                        )}
                      </div>
                      <div className="flex justify-between text-[10px]">
                        {item.orderedAt ? (
                          <>
                            <span className="text-slate-600">Ordered: <span className="font-bold">{item.orderedAt}</span></span>
                            <span className="text-slate-600">By: <span className="font-bold">{item.orderedBy}</span></span>
                          </>
                        ) : (
                          <span className="text-red-600 font-bold uppercase tracking-tighter text-[9px]">NEED TO ORDER</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest flex items-center gap-2">
          <HistoryIcon size={14} /> Field Usage Log
        </h3>
        <Card className="bg-slate-900 text-white border-none">
          <CardContent className="p-4">
            <div className="space-y-3">
              {[
                { time: '10:45', item: 'Gauze', qty: '2 packs', loc: 'Under 5th St Bridge' },
                { time: '09:30', item: 'Water', qty: '12 bottles', loc: 'Skid Row East' },
                { time: 'Yesterday', item: 'Saline', qty: '1 bottle', loc: 'Central Library' },
              ].map((log, i) => (
                <div key={i} className="flex justify-between items-center text-[10px] border-b border-white/10 pb-2 last:border-none last:pb-0">
                  <div>
                    <p className="font-bold text-blue-400">{log.item} • {log.qty}</p>
                    <p className="opacity-50">{log.loc}</p>
                  </div>
                  <p className="opacity-50">{log.time}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function InsightsView({ onNavigate }: { onNavigate: (tab: string, layer?: string) => void }) {
  const COLORS = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Program Insights</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-[10px] font-bold uppercase border-amber-200 text-amber-600" onClick={() => onNavigate('map', 'Heatmap')}>
            <MapIcon size={14} className="mr-1" /> View Heatmap
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-[10px] font-bold uppercase border-blue-200 text-blue-600">
            <Save size={14} className="mr-1" /> Grant Report
          </Button>
        </div>
      </div>

      {/* Impact Grid */}
      <div className="grid grid-cols-2 gap-3">
        {MOCK_DATA.impactMetrics.map((metric) => (
          <Card key={metric.label} className="border-slate-100 shadow-sm">
            <CardContent className="p-4">
              <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-1">{metric.label}</p>
              <div className="flex items-baseline gap-2">
                <p className="text-xl font-bold text-slate-900">{metric.value}</p>
                <span className="text-[10px] font-bold text-green-600">{metric.trend}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Seasonal Demand Trend */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest flex items-center gap-2">
            <TrendingUp size={14} /> Seasonal Supply Demand
          </h3>
          <Badge className="bg-blue-50 text-blue-600 border-blue-100 text-[8px]">PREDICTIVE AI</Badge>
        </div>
        
        <Card className="border-slate-100 shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <div className="h-[200px] w-full p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={MOCK_DATA.seasonalDemand}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="month" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontWeight: 600, fill: '#94a3b8' }} 
                  />
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-slate-900 text-white p-2 rounded-lg shadow-xl text-[10px] border border-slate-800">
                            <p className="font-bold mb-1">{data.month} Demand</p>
                            <div className="flex flex-wrap gap-1">
                              {data.items.map((item: string) => (
                                <span key={item} className="bg-white/10 px-1 rounded text-[8px]">{item}</span>
                              ))}
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar 
                    dataKey="intensity" 
                    radius={[4, 4, 0, 0]}
                    fill="#3b82f6"
                  >
                    {MOCK_DATA.seasonalDemand.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.month === 'Apr' ? '#f97316' : '#3b82f6'} 
                        fillOpacity={entry.month === 'Apr' ? 1 : 0.6}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            
            <div className="bg-slate-50 border-t border-slate-100 p-4">
              <p className="text-[10px] font-bold text-slate-500 uppercase mb-3">High Demand This Month (April)</p>
              <div className="flex flex-wrap gap-2">
                {MOCK_DATA.seasonalDemand.find(d => d.month === 'Apr')?.items.map(item => (
                  <div key={item} className="bg-white border border-orange-100 px-3 py-1.5 rounded-lg flex items-center gap-2 shadow-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                    <span className="text-[10px] font-bold text-slate-700">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Outreach Volume */}
      <Card className="p-4 border-slate-100 shadow-sm">
        <div className="flex justify-between items-start mb-6">
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Outreach Volume</p>
            <h3 className="text-lg font-bold text-slate-900">Encounters & Patient Mix</h3>
          </div>
          <div className="text-right">
            <Badge className="bg-blue-50 text-blue-600 border-blue-100 mb-1">+24% MoM</Badge>
            <p className="text-[9px] text-slate-400 font-bold uppercase">Monthly Growth</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-6">
          <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
            <p className="text-[8px] font-bold text-slate-400 uppercase mb-0.5">Encounters (MO)</p>
            <p className="text-sm font-bold text-slate-900">310</p>
            <p className="text-[7px] text-green-600 font-bold tracking-tighter">Avg 77/wk</p>
          </div>
          <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
            <p className="text-[8px] font-bold text-slate-400 uppercase mb-0.5" id="unique-patients-label">Unique Patients</p>
            <p className="text-sm font-bold text-slate-900" id="unique-patients-value">110</p>
            <p className="text-[7px] text-slate-400 font-medium tracking-tighter">Current Month</p>
          </div>
          <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
            <p className="text-[8px] font-bold text-slate-400 uppercase mb-0.5" id="new-patients-label">New Patients</p>
            <p className="text-sm font-bold text-slate-900" id="new-patients-value">60</p>
            <p className="text-[7px] text-blue-600 font-bold tracking-tighter">55% of Total</p>
          </div>
        </div>

        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={MOCK_DATA.monthlyImpact}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8'}} />
              <YAxis hide />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                cursor={{ fill: '#f8fafc' }}
              />
              <Bar dataKey="newPatients" stackId="a" fill="#60a5fa" radius={[0, 0, 0, 0]} name="New Patients" />
              <Bar dataKey="repeatPatients" stackId="a" fill="#2563eb" radius={[4, 4, 0, 0]} name="Repeat Patients" />
              <Bar dataKey="encounters" fill="#94a3b8" opacity={0.2} radius={[4, 4, 0, 0]} name="Total Encounters" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-4">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm bg-blue-600" />
            <span className="text-[9px] font-bold text-slate-500 uppercase">Repeat Patients</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm bg-blue-400" />
            <span className="text-[9px] font-bold text-slate-500 uppercase">New Patients</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm bg-slate-200" />
            <span className="text-[9px] font-bold text-slate-500 uppercase">Total Encounters</span>
          </div>
        </div>
      </Card>

      {/* Continuity of Care & Readmissions */}
      <Card className="p-4 border-slate-100 shadow-sm">
        <p className="text-[10px] font-bold uppercase text-slate-400 mb-4 tracking-widest">Healthcare Integration</p>
        <h3 className="text-lg font-bold text-slate-900 mb-6">Patient Continuity Metrics</h3>
        
        <div className="space-y-6">
          {MOCK_DATA.continuityData.map((item, idx) => (
            <div key={idx} className="space-y-2">
              <div className="flex justify-between items-end">
                <p className="text-xs font-bold text-slate-700">{item.label}</p>
                <p className="text-sm font-bold text-slate-900">
                  {item.value} <span className="text-[10px] text-slate-400 font-normal">/ {item.total} Patients</span>
                </p>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${(item.value / item.total) * 100}%` }}
                  transition={{ duration: 1, delay: idx * 0.2 }}
                  className={cn("h-full rounded-full", item.color)} 
                />
              </div>
              <p className="text-[9px] text-slate-400">
                {item.label === 'Primary Care Connected' ? 'Demonstrates successful bridge from street to clinic.' : '30-day post-discharge readmission rate tracking.'}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 pt-4 border-t border-slate-50">
          <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 p-3 rounded-xl">
            <TrendingUp size={16} />
            <p className="text-[10px] font-bold">PCP connection up 12% over last quarter due to Midtown clinic partnership.</p>
          </div>
        </div>
      </Card>

      {/* Supply Usage by Region */}
      <section className="space-y-4">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest flex items-center gap-2">
          <Package size={14} /> Supply Usage by Region
        </h3>
        <Card className="border-slate-100 shadow-sm overflow-hidden">
          <CardContent className="p-4">
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  data={MOCK_DATA.supplyUsageByRegion} 
                  layout="vertical"
                  margin={{ left: -20, right: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" hide />
                  <YAxis 
                    dataKey="region" 
                    type="category" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 9, fontWeight: 700, fill: '#64748b' }}
                    width={80}
                  />
                  <Tooltip 
                    cursor={{ fill: 'transparent' }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-white border p-2 rounded-lg shadow-xl text-[10px]">
                            <p className="font-bold text-slate-900 mb-1">{data.region}</p>
                            <p className="text-blue-600 font-bold">Top Item: {data.supply}</p>
                            <p className="text-slate-500">{data.usage} units distributed</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar 
                    dataKey="usage" 
                    radius={[0, 4, 4, 0]}
                    fill="#3b82f6"
                    barSize={20}
                  >
                    {MOCK_DATA.supplyUsageByRegion.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            
            <div className="mt-4 space-y-2">
              {MOCK_DATA.supplyUsageByRegion.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                    <span className="text-[10px] font-bold text-slate-700">{item.region}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-slate-900">{item.supply}</p>
                    <p className="text-[9px] text-slate-400">{item.usage} units</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Grant Reporting Summary */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest">Grant Reporting Summary</h3>
        <Card className="border-slate-100 shadow-sm overflow-hidden bg-white">
          <CardHeader className="p-4 border-b border-slate-50 flex flex-row items-center justify-between space-y-0">
            <h4 className="text-sm font-bold text-slate-800">Q2 Impact Overview</h4>
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-50 rounded-full border border-emerald-100">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold text-emerald-600 uppercase">On Track</span>
            </div>
          </CardHeader>
          <div className="p-4 grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Site Expansion</p>
              <div className="flex items-end gap-1.5">
                <p className="text-lg font-bold text-blue-500">3 New</p>
                <TrendingUp size={12} className="text-emerald-500 mb-1" />
              </div>
              <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 w-[75%]" />
              </div>
              <p className="text-[8px] text-slate-400 font-medium">75% of Annual Goal</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Patient Volume</p>
              <div className="flex items-end gap-1.5">
                <p className="text-lg font-bold text-slate-900">+18%</p>
                <TrendingUp size={12} className="text-emerald-500 mb-1" />
              </div>
              <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 w-[90%]" />
              </div>
              <p className="text-[8px] text-slate-400 font-medium">Target Met</p>
            </div>
          </div>
        </Card>

        {/* Progress Over Time */}
        <Card className="border-slate-100 shadow-sm overflow-hidden">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900">Engagement Journey</h4>
              <div className="flex items-center gap-1 text-emerald-500">
                <TrendingUp size={14} />
                <span className="text-[10px] font-bold uppercase">Improving</span>
              </div>
            </div>

            <div className="space-y-6 mt-2">
              {MOCK_DATA.progressOverTime.map((item, idx) => (
                <div key={idx} className="space-y-3">
                  <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider transition-all hover:text-blue-500 cursor-default">{item.metric}</p>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 text-center">
                      <div className="h-1 w-full bg-slate-100 rounded-full mb-2" />
                      <p className="text-[9px] font-medium text-slate-400">Baseline</p>
                      <p className="text-[10px] font-bold text-slate-600 mt-1 italic leading-tight">“{item.baseline}”</p>
                    </div>
                    <div className="flex items-center text-blue-300">
                      <ChevronRight size={14} />
                    </div>
                    <div className="flex-1 text-center">
                      <div className="h-1 w-full bg-blue-500 rounded-full mb-2 shadow-[0_0_8px_rgba(59,130,246,0.4)]" />
                      <p className="text-[9px] font-medium text-blue-500">Current</p>
                      <p className="text-[10px] font-bold text-slate-900 mt-1 italic leading-tight">“{item.current}”</p>
                    </div>
                    <div className="flex items-center text-slate-200">
                      <ChevronRight size={14} />
                    </div>
                    <div className="flex-1 text-center">
                      <div className="h-1 w-full bg-slate-100 rounded-full mb-2" />
                      <p className="text-[9px] font-medium text-slate-400">Goal</p>
                      <p className="text-[10px] font-bold text-slate-500 mt-1 italic leading-tight">“{item.goal}”</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[8px] text-slate-400 text-center italic mt-2">Click labels to customize metrics for this report period.</p>
          </CardContent>
        </Card>

        {/* Key Outcomes */}
        <Card className="border-slate-100 shadow-sm bg-white">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-50 pb-2">
              <h4 className="text-sm font-bold text-slate-900">Key Outcomes</h4>
              <span className="text-[8px] font-bold text-slate-400 uppercase bg-slate-50 px-1.5 py-0.5 rounded">Filter: Q2</span>
            </div>
            
            <div className="space-y-5">
              {MOCK_DATA.keyOutcomes.map((outcome, idx) => (
                <div key={idx} className="group">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "mt-1 w-1 h-1 rounded-full bg-blue-400 transition-all group-hover:scale-150",
                      outcome.status === 'On Track' && "bg-emerald-400",
                      outcome.status === 'Needs Attention' && "bg-amber-400",
                      outcome.status === 'At Risk' && "bg-rose-400"
                    )} />
                    <div className="flex-1 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold text-slate-700 uppercase tracking-tight">{outcome.category}</p>
                        <div className={cn(
                          "px-2 py-0.5 rounded-sm text-[8px] font-bold uppercase tracking-widest",
                          outcome.status === 'On Track' ? "bg-emerald-50 text-emerald-600" :
                          outcome.status === 'Needs Attention' ? "bg-amber-50 text-amber-600" :
                          "bg-rose-50 text-rose-600"
                        )}>
                          {outcome.status}
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                        {outcome.insight}
                      </p>
                      <div className="flex items-center gap-1 pt-1">
                        {outcome.trend.startsWith('+') ? <TrendingUp size={10} className="text-emerald-500" /> : 
                         outcome.trend.startsWith('-') ? <TrendingDown size={10} className="text-rose-500" /> : 
                         <Minus size={10} className="text-slate-300" />}
                        <span className={cn(
                          "text-[9px] font-bold",
                          outcome.trend.startsWith('+') ? "text-emerald-500" : 
                          outcome.trend.startsWith('-') ? "text-rose-500" : 
                          "text-slate-400"
                        )}>{outcome.trend}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-4 border-t border-slate-50 grid grid-cols-1 gap-2">
              <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest mb-1 text-center">Insight Prompts</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {["What changed?", "Who is being reached?", "How has access improved?"].map((prompt) => (
                  <span key={prompt} className="text-[9px] bg-slate-50 text-slate-400 px-2 py-1 rounded-full border border-slate-100 cursor-help hover:bg-white hover:text-blue-500 transition-all">
                    {prompt}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Report Actions */}
        <div className="flex gap-3 pt-2">
          <Button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold uppercase tracking-widest h-10 shadow-md shadow-blue-100">
            <FileText size={14} className="mr-2" />
            Generate Grant Report
          </Button>
          <Button variant="outline" className="flex-1 border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest h-10 hover:bg-slate-50">
            <Settings2 size={14} className="mr-2 text-slate-400" />
            Edit Metrics
          </Button>
        </div>
      </section>

      <Card className="bg-blue-50 border-blue-100">
        <CardContent className="p-4 flex gap-3">
          <div className="bg-blue-600 text-white p-2 rounded-lg h-fit"><TrendingUp size={16} /></div>
          <div>
            <p className="text-xs font-bold text-blue-900">Rising Need Alert</p>
            <p className="text-[10px] text-blue-700 leading-relaxed">Encounters in **Cass Corridor** have increased by 35% this month. Recommend shifting 20% of inventory to Van 2 for this route.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function History(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

function MemberManagementView({ onBack }: { onBack: () => void }) {
  const [members, setMembers] = useState([
    { id: '1', name: 'Marcus Miller', role: 'Nurse Practitioner', status: 'Active', access: 'Standard' },
    { id: '2', name: 'Elena Rodriguez', role: 'Social Worker', status: 'Active', access: 'Standard' },
    { id: '3', name: 'David Kim', role: 'Medical Student', status: 'Inactive', access: 'View Only' },
    { id: '4', name: 'Sarah Chen, RN', role: 'Administrator', status: 'Active', access: 'Full Admin', isSelf: true },
  ]);

  const toggleStatus = (id: string) => {
    setMembers(prev => prev.map(m => {
      if (m.id === id && !m.isSelf) {
        return { ...m, status: m.status === 'Active' ? 'Inactive' : 'Active' };
      }
      return m;
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 rounded-full">
          <ChevronLeft size={20} />
        </Button>
        <h2 className="text-xl font-bold">Team Access</h2>
      </div>

      <div className="bg-blue-50 border border-blue-100 p-4 rounded-2xl flex gap-3 items-start">
        <Shield size={20} className="text-blue-600 mt-0.5" />
        <div className="space-y-1">
          <p className="text-xs font-bold text-blue-900">Admin Authority Enabled</p>
          <p className="text-[10px] text-blue-700 leading-relaxed">
            You are managing access for <b>Street Medicine Detroit</b>. You can revoke credentials or update permissions at any time.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {members.map((member) => (
          <Card key={member.id} className={cn("border-slate-200", member.status === 'Inactive' && "opacity-60")}>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm",
                  member.status === 'Active' ? "bg-slate-100 text-slate-600" : "bg-slate-200 text-slate-400"
                )}>
                  {member.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900 flex items-center gap-1">
                    {member.name} {member.isSelf && <span className="text-[8px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full uppercase tracking-tighter">You</span>}
                  </p>
                  <p className="text-[10px] text-slate-500">{member.role} • <span className="font-bold">{member.access} Access</span></p>
                </div>
              </div>
              
              {!member.isSelf && (
                <div className="flex flex-col items-end gap-2">
                  <Badge className={cn(
                    "text-[8px] font-bold uppercase py-0.5",
                    member.status === 'Active' ? "bg-green-100 text-green-700 border-green-200" : "bg-slate-100 text-slate-500 border-slate-200"
                  )} variant="outline">
                    {member.status}
                  </Badge>
                  <button 
                    onClick={() => toggleStatus(member.id)}
                    className="text-[9px] font-bold text-blue-600 hover:underline uppercase tracking-tight"
                  >
                    {member.status === 'Active' ? 'Deactivate' : 'Restore'}
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Button className="w-full h-12 bg-white text-slate-900 border border-slate-200 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-50">
        <Plus size={18} />
        <span>Provision New Member</span>
      </Button>
    </div>
  );
}
function ProfileView({ user, onNavigate }: { user: any, onNavigate: (tab: string) => void }) {
  return (
    <div className="space-y-6">
      {/* Header Profile Section */}
      <div className="flex flex-col items-center text-center space-y-4 py-4">
        <div className="relative">
          <div className="h-24 w-24 rounded-full bg-blue-100 border-4 border-white shadow-xl flex items-center justify-center text-3xl font-bold text-blue-600">
            SC
          </div>
          <div className="absolute bottom-0 right-0 bg-blue-600 text-white p-1.5 rounded-full border-2 border-white shadow-sm">
            <User size={14} />
          </div>
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{user.name}</h2>
          <p className="text-blue-600 font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-1">
            {user.role} {user.isAdmin && <Shield size={12} className="fill-blue-600/20" />}
          </p>
        </div>
      </div>

      {/* Admin Controls Area */}
      {user.isAdmin && (
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest pl-1">Admin Control Center</h3>
          <button 
            onClick={() => onNavigate('management')}
            className="w-full bg-blue-600 p-4 rounded-xl flex items-center justify-between shadow-lg shadow-blue-100 hover:bg-blue-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg text-white"><Users size={20} /></div>
              <div className="text-left">
                <p className="text-sm font-bold text-white">Manage Team Access</p>
                <p className="text-[10px] text-blue-100 italic">Control permissions & active members</p>
              </div>
            </div>
            <ChevronRight size={20} className="text-white" />
          </button>
        </section>
      )}

      {/* Info Cards */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest pl-1">Professional Identity</h3>
        <Card className="border-slate-200">
          <CardContent className="p-0 divide-y divide-slate-100">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-50 rounded-lg text-slate-400"><FileText size={18} /></div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Agency</p>
                  <p className="text-sm font-bold text-slate-900">{user.agency}</p>
                </div>
              </div>
            </div>
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-50 rounded-lg text-slate-400"><Mail size={18} /></div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Email Address</p>
                  <p className="text-sm font-bold text-slate-900">{user.email}</p>
                </div>
              </div>
            </div>
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-50 rounded-lg text-slate-400"><Briefcase size={18} /></div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Current Assignment</p>
                  <p className="text-sm font-bold text-slate-900">{user.team}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Settings/Actions */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest pl-1">Account & Security</h3>
        <div className="space-y-2">
          {[
            { label: 'Security Settings', icon: Shield, color: 'text-slate-600' },
            { label: 'Notification Prefs', icon: Bell, color: 'text-slate-600' },
            { label: 'App Feedback', icon: MessageSquare, color: 'text-slate-600' },
            { label: 'Log Out', icon: LogOut, color: 'text-red-600' },
          ].map((item, idx) => (
            <button key={idx} className="w-full bg-white p-4 rounded-xl border border-slate-100 flex items-center justify-between hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <item.icon size={18} className={item.color} />
                <span className={cn("text-sm font-bold", item.color)}>{item.label}</span>
              </div>
              <ChevronRight size={16} className="text-slate-300" />
            </button>
          ))}
        </div>
      </section>

      <div className="text-center pt-4">
        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Sineobex v1.4.2</p>
        <p className="text-[9px] text-slate-300 mt-1">Last Sync: Today at 2:45 PM</p>
      </div>
    </div>
  );
}
