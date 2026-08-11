import { ANSWER_MAX, PROMPT_MAX, valuesForCount } from '../constants.js';
import { SettingsForm } from './SettingsForm.jsx';

export function LobbyScreen({
  room,
  isHost,
  session,
  qrDataUrl,
  me,
  editingQuestions,
  onEditQuestions,
  settingsEditMode,
  settingsDraft,
  onSettingsDraftChange,
  onToggleSettingsEdit,
  onSaveSettings,
  busy,
  drafts,
  invalidDraftIds,
  onUpdateDraft,
  onUpdateDraftValue,
  onSubmitQuestions,
  onKickPlayer,
  allSubmitted,
  onContinueToTeamSetup
}) {
  return (
    <>
      {isHost && qrDataUrl && (
        <section className="card invite-card">
          <div>
            <h2>Invite Players</h2>
            <p>Scan to join, or use Copy Link above.</p>
          </div>
          <img src={qrDataUrl} alt="QR code to join game" className="qr-code" />
        </section>
      )}

      <section className="card">
        <h2>Question Submission</h2>
        <p>Each player writes {room.settings.questionsPerPlayer} questions, one per point value.</p>

        {me?.submitted && !editingQuestions && (
          <div className="lobby-ready">
            <div className="pill success">
              Questions submitted. {isHost ? 'Waiting for everyone else.' : 'Waiting for the host.'}
            </div>
            <button type="button" className="secondary subtle" onClick={() => onEditQuestions(true)}>
              Edit My Questions
            </button>
          </div>
        )}

        {isHost && (
          <div className="settings-editor">
            {settingsEditMode ? (
              <>
                <SettingsForm
                  questionsPerPlayer={settingsDraft.questionsPerPlayer}
                  onQuestionsPerPlayerChange={(value) => onSettingsDraftChange('questionsPerPlayer', value)}
                  mode={settingsDraft.mode}
                  onModeChange={(value) => onSettingsDraftChange('mode', value)}
                  rounds={settingsDraft.rounds}
                  onRoundsChange={(value) => onSettingsDraftChange('rounds', value)}
                  timerSeconds={settingsDraft.timerSeconds}
                  onTimerSecondsChange={(value) => onSettingsDraftChange('timerSeconds', value)}
                  dailyDouble={settingsDraft.dailyDouble}
                  onDailyDoubleChange={(value) => onSettingsDraftChange('dailyDouble', value)}
                />
                <button type="button" disabled={Boolean(busy)} onClick={onSaveSettings}>
                  {busy === 'save-settings' ? 'Saving…' : 'Save Settings'}
                </button>
                <button type="button" className="subtle" onClick={onToggleSettingsEdit}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="subtle" onClick={onToggleSettingsEdit}>
                Edit Settings
              </button>
            )}
          </div>
        )}

        {(!me?.submitted || editingQuestions) && (
          <>
            <div className="question-grid">
              {drafts.map((draft) => (
                <div key={draft.localId} className={`question-card${invalidDraftIds.has(draft.localId) ? ' invalid' : ''}`}>
                  <div className="question-head">
                    <label>Value</label>
                    <select value={draft.value} onChange={(event) => onUpdateDraftValue(draft.localId, event.target.value)}>
                      {valuesForCount(room.settings.questionsPerPlayer).map((value) => (
                        <option key={value} value={value}>
                          ${value}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label>Question</label>
                  <textarea
                    rows={3}
                    maxLength={PROMPT_MAX}
                    value={draft.prompt}
                    placeholder="Write the clue/question"
                    onChange={(event) => onUpdateDraft(draft.localId, 'prompt', event.target.value)}
                  />
                  {draft.prompt.length >= PROMPT_MAX * 0.8 && (
                    <div className={`char-count${draft.prompt.length >= PROMPT_MAX ? ' danger' : ''}`}>
                      {draft.prompt.length}/{PROMPT_MAX}
                    </div>
                  )}
                  <label>Answer</label>
                  <input
                    maxLength={ANSWER_MAX}
                    value={draft.answer}
                    placeholder="Expected answer"
                    onChange={(event) => onUpdateDraft(draft.localId, 'answer', event.target.value)}
                  />
                  {draft.answer.length >= ANSWER_MAX * 0.8 && (
                    <div className={`char-count${draft.answer.length >= ANSWER_MAX ? ' danger' : ''}`}>
                      {draft.answer.length}/{ANSWER_MAX}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button type="button" disabled={Boolean(busy)} onClick={onSubmitQuestions}>
              {busy === 'submit-questions' ? 'Submitting…' : 'Submit My Questions'}
            </button>
          </>
        )}

        <div className="players-list">
          {room.players.map((player) => (
            <div key={player.id} className={`pill ${player.submitted ? 'success' : ''}${!player.isConnected ? ' offline' : ''}`}>
              {player.name} · {player.submitted ? 'Ready' : 'Editing'}
              {!player.isConnected ? ' (offline)' : ''}
              {isHost && player.id !== session.playerId && (
                <button
                  type="button"
                  className="pill-kick"
                  disabled={Boolean(busy)}
                  onClick={() => onKickPlayer(player.id, player.name)}
                  aria-label={`Remove ${player.name}`}
                  title={`Remove ${player.name}`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        {isHost && (
          <button type="button" disabled={!allSubmitted || Boolean(busy)} onClick={onContinueToTeamSetup}>
            {busy === 'continue' ? 'Continuing…' : 'Continue to Team Setup'}
          </button>
        )}
      </section>
    </>
  );
}
