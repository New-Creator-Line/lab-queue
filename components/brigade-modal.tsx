"use client";

import {
  Check,
  Crown,
  LoaderCircle,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export type BrigadeMember = {
  telegramId: string;
  displayName: string;
  username: string | null;
  subgroup: number | null;
  isLeader: boolean;
};

export type BrigadeDetail = {
  id: number;
  subjectKey: string;
  subgroup: number;
  name: string;
  leaderTelegramId: string;
  leaderDisplayName: string;
  createdAt: string;
  members: BrigadeMember[];
};

export type AvailableStudent = {
  telegramId: string;
  displayName: string;
  username: string | null;
  subgroup?: number | null;
};

type BrigadeModalProps = {
  isOpen: boolean;
  onClose: () => void;
  subject: { key: string; name: string; abbrev: string } | null;
  currentUser: {
    telegramId: string;
    displayName: string;
    username: string | null;
    subgroup: number | null;
    isAdmin: boolean;
  };
  onBrigadeUpdated?: () => void;
  isAdminMode?: boolean;
};

export function BrigadeModal({
  isOpen,
  onClose,
  subject,
  currentUser,
  onBrigadeUpdated,
  isAdminMode = false,
}: BrigadeModalProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [myBrigade, setMyBrigade] = useState<BrigadeDetail | null>(null);
  const [allBrigades, setAllBrigades] = useState<BrigadeDetail[]>([]);
  const [availableStudents, setAvailableStudents] = useState<AvailableStudent[]>([]);
  const [isWholeGroup, setIsWholeGroup] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [brigadeName, setBrigadeName] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [transferLeaderId, setTransferLeaderId] = useState<string | null>(null);

  const subjectKey = subject?.key;
  const currentUserId = currentUser.telegramId;

  const loadData = useCallback(async (targetKey?: string) => {
    const key = targetKey ?? subjectKey;
    if (!key) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/brigades?subjectKey=${encodeURIComponent(key)}`);
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        myBrigade?: BrigadeDetail | null;
        allBrigades?: BrigadeDetail[];
        availableStudents?: AvailableStudent[];
        isWholeGroup?: boolean;
      };
      if (!res.ok) {
        throw new Error(data.error || "Ошибка загрузки");
      }
      setMyBrigade(data.myBrigade || null);
      setAllBrigades(data.allBrigades || []);
      setAvailableStudents(data.availableStudents || []);
      setIsWholeGroup(Boolean(data.isWholeGroup));

      if (data.myBrigade) {
        setBrigadeName(data.myBrigade.name);
        setSelectedMemberIds(
          data.myBrigade.members
            .filter((m: BrigadeMember) => m.telegramId !== currentUserId)
            .map((m: BrigadeMember) => m.telegramId),
        );
      } else {
        setBrigadeName(`Бригада ${(data.allBrigades?.length ?? 0) + 1}`);
        setSelectedMemberIds([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [subjectKey, currentUserId]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !subjectKey) return;

    const timer = window.setTimeout(() => {
      setIsEditing(false);
      setTransferLeaderId(null);
      void loadData(subjectKey);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, subjectKey, loadData]);

  if (!isOpen || !subject) return null;

  const isLeader = myBrigade?.leaderTelegramId === currentUser.telegramId;

  function toggleMember(telegramId: string) {
    setSelectedMemberIds((prev) =>
      prev.includes(telegramId)
        ? prev.filter((id) => id !== telegramId)
        : [...prev, telegramId],
    );
  }

  function handleCancelEdit() {
    setIsEditing(false);
    if (myBrigade) {
      setBrigadeName(myBrigade.name);
      setSelectedMemberIds(
        myBrigade.members
          .filter((m) => m.telegramId !== currentUser.telegramId)
          .map((m) => m.telegramId),
      );
    }
  }

  async function handleSaveBrigade() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/brigades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectKey: subject?.key,
          name: brigadeName.trim() || undefined,
          memberTelegramIds: selectedMemberIds,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Не удалось сохранить бригаду");
      }
      setIsEditing(false);
      await loadData();
      onBrigadeUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка при сохранении");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisbandBrigade() {
    if (!myBrigade) return;
    if (!window.confirm(`Вы уверены, что хотите расформировать бригаду «${myBrigade.name}»?`)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/brigades", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brigadeId: myBrigade.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Не удалось расформировать");
      }
      setMyBrigade(null);
      await loadData();
      onBrigadeUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка расформирования");
    } finally {
      setSaving(false);
    }
  }

  async function handleTransferLeadership() {
    if (!myBrigade || !transferLeaderId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/brigades/leader", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brigadeId: myBrigade.id,
          newLeaderTelegramId: transferLeaderId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Не удалось передать лидерство");
      }
      setTransferLeaderId(null);
      await loadData();
      onBrigadeUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка передачи лидерства");
    } finally {
      setSaving(false);
    }
  }

  async function handleAdminDisbandBrigade(brigadeId: number, name: string) {
    if (!window.confirm(`Вы уверены, что хотите расформировать бригаду «${name}»?`)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/brigades", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brigadeId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Не удалось расформировать бригаду");
      }
      await loadData();
      onBrigadeUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка расформирования");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="brigade-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="brigade-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="brigade-modal-head">
          <div>
            <h3 id="brigade-modal-title">
              {isAdminMode ? `Бригады по предмету · ${subject.abbrev}` : `Бригада · ${subject.abbrev}`}
            </h3>
            <small style={{ color: "#64748b" }}>{subject.name}</small>
          </div>
          <button className="brigade-modal-close" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="brigade-modal-body">
          {error && (
            <div style={{ background: "#fef2f2", color: "#b91c1c", padding: "10px 14px", borderRadius: 10, fontSize: 13, border: "1px solid #fecaca" }}>
              {error}
            </div>
          )}

          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "30px 0", gap: 8, color: "#64748b" }}>
              <LoaderCircle className="spin" size={20} /> Загрузка данных о бригадах…
            </div>
          ) : isAdminMode ? (
            /* Admin view: management of all brigades */
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Сформированные бригады ({allBrigades.length}):
              </span>

              {allBrigades.length === 0 ? (
                <div style={{ padding: "30px 10px", textAlign: "center", color: "#64748b", fontSize: 13 }}>
                  По этому предмету ещё не создано ни одной бригады
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 380, overflowY: "auto" }}>
                  {allBrigades.map((brigade) => (
                    <div key={brigade.id} className="other-brigade-card" style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <strong style={{ fontSize: 14 }}>{brigade.name}</strong>
                            <span className="subgroup-tag" style={{ fontSize: 10 }}>
                              {brigade.subgroup === 0 ? "Вся группа" : `${brigade.subgroup}-я подгруппа`}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                            Лидер: <strong style={{ color: "var(--ink)" }}>{brigade.leaderDisplayName}</strong>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn-danger-outline"
                          style={{ padding: "5px 10px", fontSize: 11 }}
                          onClick={() => handleAdminDisbandBrigade(brigade.id, brigade.name)}
                          disabled={saving}
                          title="Расформировать бригаду"
                        >
                          <Trash2 size={13} /> Расформировать
                        </button>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                        {brigade.members.map((m) => (
                          <span
                            key={m.telegramId}
                            className={m.isLeader ? "brigade-member-tag is-leader" : "brigade-member-tag"}
                          >
                            {m.isLeader && <Crown size={12} />}
                            {m.displayName}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : myBrigade && !isEditing ? (
            /* View existing brigade */
            <div className="brigade-info-card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <span className="brigade-slot-badge">Ваша бригада</span>
                  <h4 style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 800 }}>{myBrigade.name}</h4>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Состав бригады ({myBrigade.members.length}):
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {myBrigade.members.map((m) => (
                    <div
                      key={m.telegramId}
                      className={m.telegramId === currentUser.telegramId ? "brigade-member-card is-me" : "brigade-member-card"}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="actual-avatar" style={{ width: 28, height: 28, fontSize: 12 }}>
                          {m.displayName.slice(0, 1)}
                        </span>
                        <div>
                          <strong style={{ fontSize: 13 }}>{m.displayName}</strong>
                          {m.telegramId === currentUser.telegramId && (
                            <span style={{ marginLeft: 6, fontSize: 11, color: "#2563eb", fontWeight: 700 }}>(вы)</span>
                          )}
                          {isWholeGroup && m.subgroup && (
                            <span className="subgroup-tag" style={{ fontSize: 10, marginLeft: 6 }}>
                              {m.subgroup}-я подгруппа
                            </span>
                          )}
                        </div>
                      </div>
                      {m.isLeader ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#f59e0b", fontSize: 12, fontWeight: 700 }}>
                          <Crown size={14} /> Лидер
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              {isLeader && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}>
                  <button
                    className="btn-secondary-btn"
                    onClick={() => {
                      setIsEditing(true);
                      setBrigadeName(myBrigade.name);
                    }}
                  >
                    <UserPlus size={15} /> Изменить состав
                  </button>
                  <button
                    className="btn-danger-outline"
                    onClick={handleDisbandBrigade}
                    disabled={saving}
                  >
                    <Trash2 size={14} /> Расформировать
                  </button>
                </div>
              )}

              {isLeader && myBrigade.members.length > 1 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <select
                      className="brigade-input"
                      style={{ padding: "6px 10px", fontSize: 12 }}
                      value={transferLeaderId ?? ""}
                      onChange={(e) => setTransferLeaderId(e.target.value || null)}
                    >
                      <option value="">Передать лидерство участнику…</option>
                      {myBrigade.members
                        .filter((m) => m.telegramId !== currentUser.telegramId)
                        .map((m) => (
                          <option key={m.telegramId} value={m.telegramId}>
                            {m.displayName}
                          </option>
                        ))}
                    </select>
                    <button
                      className="btn-secondary-btn"
                      style={{ padding: "6px 12px", fontSize: 12 }}
                      disabled={!transferLeaderId || saving}
                      onClick={handleTransferLeadership}
                    >
                      Передать
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Create or Edit Brigade Form */
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="brigade-form-group">
                <label>Название бригады</label>
                <input
                  type="text"
                  className="brigade-input"
                  placeholder="Например, Бригада 1"
                  value={brigadeName}
                  onChange={(e) => setBrigadeName(e.target.value)}
                />
              </div>

              <div className="brigade-form-group">
                <label>
                  {isWholeGroup
                    ? "Выберите участников из всей группы:"
                    : `Выберите участников из вашей подгруппы (${currentUser.subgroup ?? 1}-я подгруппа):`}
                </label>
                <div className="member-select-list">
                  {/* Current user is always in the brigade */}
                  <label className="member-select-item" style={{ opacity: 0.85 }}>
                    <input type="checkbox" checked disabled />
                    <strong>{currentUser.displayName}</strong>
                    <span style={{ fontSize: 11, color: "#64748b" }}>(Вы, лидер)</span>
                    {isWholeGroup && currentUser.subgroup && (
                      <span className="subgroup-tag" style={{ fontSize: 10, marginLeft: 6 }}>
                        {currentUser.subgroup}-я подгруппа
                      </span>
                    )}
                  </label>

                  {/* Existing members if editing */}
                  {isEditing &&
                    myBrigade?.members
                      .filter((m) => m.telegramId !== currentUser.telegramId)
                      .map((m) => (
                        <label key={m.telegramId} className="member-select-item">
                          <input
                            type="checkbox"
                            checked={selectedMemberIds.includes(m.telegramId)}
                            onChange={() => toggleMember(m.telegramId)}
                          />
                          <span>{m.displayName}</span>
                          {isWholeGroup && m.subgroup && (
                            <span className="subgroup-tag" style={{ fontSize: 10, marginLeft: 6 }}>
                              {m.subgroup}-я подгруппа
                            </span>
                          )}
                        </label>
                      ))}

                  {/* Available students */}
                  {availableStudents
                    .filter(
                      (s) =>
                        s.telegramId !== currentUser.telegramId &&
                        !myBrigade?.members.some((m) => m.telegramId === s.telegramId),
                    )
                    .map((student) => (
                      <label key={student.telegramId} className="member-select-item">
                        <input
                          type="checkbox"
                          checked={selectedMemberIds.includes(student.telegramId)}
                          onChange={() => toggleMember(student.telegramId)}
                        />
                        <span>{student.displayName}</span>
                        {isWholeGroup && student.subgroup && (
                          <span className="subgroup-tag" style={{ fontSize: 10, marginLeft: 6 }}>
                            {student.subgroup}-я подгруппа
                          </span>
                        )}
                      </label>
                    ))}

                  {availableStudents.length === 0 && (!isEditing || myBrigade?.members.length === 1) && (
                    <div style={{ padding: "10px", fontSize: 13, color: "#64748b", textAlign: "center" }}>
                      {isWholeGroup
                        ? "Все одногруппники уже распределены по бригадам"
                        : "Все одногруппники вашей подгруппы уже распределены по бригадам"}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                {isEditing && (
                  <button
                    className="btn-secondary-btn"
                    onClick={handleCancelEdit}
                    disabled={saving}
                  >
                    Отмена
                  </button>
                )}
                <button
                  className="btn-primary-purple"
                  onClick={handleSaveBrigade}
                  disabled={saving || !brigadeName.trim()}
                >
                  {saving ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Check size={15} />
                  )}
                  {isEditing ? "Сохранить изменения" : "Создать бригаду"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="brigade-modal-footer">
          <button className="btn-secondary-btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
