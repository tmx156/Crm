import React, { useState, useEffect } from 'react';
import { FiUser, FiEdit2, FiCheck } from 'react-icons/fi';
import axios from 'axios';

/**
 * Model stats for the calendar's appointment card - DOB, height, chest,
 * waist, hips, eyes, hair colour and length.
 *
 * Ported from the Alan CRM's Calendar, where it lived inline. Pulled out into
 * its own component here because this CRM's Calendar is already several
 * thousand lines; the markup, fields, options and styling are Alan's.
 *
 * Differences from the original:
 *  - Viewers see the stats but get no Edit button. "viewer" is a read-only role
 *    in this CRM (see routes/photos.js); Alan has no such role.
 *  - A failed save shows inline rather than in a blocking alert(), and a
 *    successful one just flips back to the display view, which shows the new
 *    values - confirmation enough without a popup.
 *  - DOB is formatted from the stored YYYY-MM-DD directly. new Date() on a
 *    bare date is UTC midnight, which renders as the day before anywhere west
 *    of Greenwich.
 *
 * Needs migrations/add-model-stats-columns.sql. Before that has run the
 * server leaves these fields out, so every value reads "—" and a save is
 * silently ignored rather than breaking the booking update.
 */

const STAT_FIELDS = [
  'date_of_birth', 'height_inches', 'chest_inches', 'waist_inches',
  'hips_inches', 'eye_color', 'hair_color', 'hair_length'
];

const EYE_COLORS = ['Brown', 'Blue', 'Green', 'Hazel', 'Grey', 'Amber'];
const HAIR_COLORS = ['Black', 'Brown', 'Blonde', 'Red', 'Auburn', 'Grey', 'White'];
const HAIR_LENGTHS = ['Bald', 'Buzz', 'Short', 'Medium', 'Long', 'Very Long'];

const READ_ONLY_ROLES = ['viewer'];

const toForm = (lead) => ({
  date_of_birth: lead?.date_of_birth ? String(lead.date_of_birth).split('T')[0] : '',
  height_inches: lead?.height_inches ?? '',
  chest_inches: lead?.chest_inches ?? '',
  waist_inches: lead?.waist_inches ?? '',
  hips_inches: lead?.hips_inches ?? '',
  eye_color: lead?.eye_color || '',
  hair_color: lead?.hair_color || '',
  hair_length: lead?.hair_length || ''
});

/** "1969-09-02" -> "02/09/1969", without a timezone round-trip. */
const formatDob = (value) => {
  if (!value) return '—';
  const [y, m, d] = String(value).split('T')[0].split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};

const inches = (value) => (value !== null && value !== undefined && value !== '' ? `${value}"` : '—');

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 ' +
  'focus:ring-gray-400 focus:border-transparent transition-all';

const ModelStatsCard = ({ lead, user, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(() => toForm(lead));

  const canEdit = !READ_ONLY_ROLES.includes(user?.role);

  // Switching to another appointment resets to that lead's values, in display
  // mode, so a half-finished edit never carries over to the wrong person.
  useEffect(() => {
    setForm(toForm(lead));
    setEditing(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id]);

  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSave = async () => {
    if (!lead?.id) return;
    setSaving(true);
    setError(null);

    const toInt = (v) => (v === '' || v === null || v === undefined ? null : parseInt(v, 10));
    const payload = {
      date_of_birth: form.date_of_birth || null,
      height_inches: toInt(form.height_inches),
      chest_inches: toInt(form.chest_inches),
      waist_inches: toInt(form.waist_inches),
      hips_inches: toInt(form.hips_inches),
      eye_color: form.eye_color || null,
      hair_color: form.hair_color || null,
      hair_length: form.hair_length || null
    };

    try {
      const { data } = await axios.put(`/api/leads/${lead.id}`, payload);
      if (data?.success === false) throw new Error(data.message || 'Save failed');

      // The route returns the lead re-read from the database. If the stats
      // keys are absent from it the columns do not exist yet and nothing was
      // written - say so, rather than showing values that were never saved.
      const stored = data?.lead;
      if (stored && !('height_inches' in stored)) {
        throw new Error('Model stats are not set up in the database yet (run migrations/add-model-stats-columns.sql)');
      }

      const saved = {};
      STAT_FIELDS.forEach(f => { saved[f] = stored && f in stored ? stored[f] : payload[f]; });

      onSaved?.(saved);
      setEditing(false);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to save stats');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setForm(toForm(lead));
    setError(null);
    setEditing(false);
  };

  return (
    <div className="mt-4 bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-100 rounded-xl p-4 border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h5 className="text-xs font-bold text-gray-700 uppercase tracking-widest flex items-center">
          <span className="w-6 h-6 rounded-full bg-gradient-to-r from-gray-800 to-gray-600 flex items-center justify-center mr-2">
            <FiUser className="h-3 w-3 text-white" />
          </span>
          Model Stats
        </h5>
        {canEdit && (
          <button
            onClick={editing ? cancel : () => setEditing(true)}
            className="text-xs text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
          >
            <FiEdit2 className="h-3 w-3" />
            {editing ? 'Cancel' : 'Edit'}
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date of Birth</label>
              <input type="date" value={form.date_of_birth} onChange={set('date_of_birth')} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Height (inches)</label>
              <input type="number" min="0" value={form.height_inches} onChange={set('height_inches')}
                placeholder="e.g. 65" className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Chest (inches)</label>
              <input type="number" min="0" value={form.chest_inches} onChange={set('chest_inches')}
                placeholder="e.g. 34" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Waist (inches)</label>
              <input type="number" min="0" value={form.waist_inches} onChange={set('waist_inches')}
                placeholder="e.g. 28" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Hips (inches)</label>
              <input type="number" min="0" value={form.hips_inches} onChange={set('hips_inches')}
                placeholder="e.g. 36" className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Eye Color</label>
              <select value={form.eye_color} onChange={set('eye_color')} className={inputClass}>
                <option value="">Select...</option>
                {EYE_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Hair Color</label>
              <select value={form.hair_color} onChange={set('hair_color')} className={inputClass}>
                <option value="">Select...</option>
                {HAIR_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Hair Length</label>
              <select value={form.hair_length} onChange={set('hair_length')} className={inputClass}>
                <option value="">Select...</option>
                {HAIR_LENGTHS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full mt-2 px-4 py-2 bg-gradient-to-r from-gray-800 to-gray-700 text-white text-sm font-medium rounded-lg hover:from-gray-700 hover:to-gray-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <FiCheck className="h-4 w-4" />
                Save Stats
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {[
            ['DOB', formatDob(lead?.date_of_birth)],
            ['Height', inches(lead?.height_inches)],
            ['Chest', inches(lead?.chest_inches)],
            ['Waist', inches(lead?.waist_inches)],
            ['Hips', inches(lead?.hips_inches)],
            ['Eyes', lead?.eye_color || '—'],
            ['Hair', lead?.hair_color || '—']
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between items-center py-1.5 border-b border-gray-200">
              <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
              <span className="text-sm font-medium text-gray-900">{value}</span>
            </div>
          ))}
          <div className="col-span-2 flex justify-between items-center py-1.5">
            <span className="text-xs text-gray-500 uppercase tracking-wide">Hair Length</span>
            <span className="text-sm font-medium text-gray-900">{lead?.hair_length || '—'}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelStatsCard;
