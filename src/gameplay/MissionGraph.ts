import type { ExpeditionMissionId } from '../core/types';

export type MissionMetric = 'repaired' | 'wave' | 'score' | 'bosses';
export interface MissionStage { id: string; label: string; metric: MissionMetric; target: number }
export interface MissionGraph { id: ExpeditionMissionId; stages: readonly MissionStage[] }
export interface MissionContext { repaired: number; wave: number; score: number; bosses: number }
export interface MissionGraphProgress { stage: number; value: number; target: number; complete: boolean; label: string }

const single = (id: ExpeditionMissionId, metric: MissionMetric, target: number, label: string): MissionGraph => ({ id, stages: [{ id: `${id}-goal`, metric, target, label }] });

export const MISSION_GRAPHS: Record<ExpeditionMissionId, MissionGraph> = {
  'spring-bridge': single('spring-bridge', 'repaired', 8, '修复桥梁机器人'),
  'spring-river': single('spring-river', 'wave', 3, '守护补给波次'),
  'spring-garden': { id: 'spring-garden', stages: [
    { id: 'wake-seeds', label: '唤醒花种机器人', metric: 'repaired', target: 4 },
    { id: 'guard-bloom', label: '守护花田开放', metric: 'wave', target: 4 },
  ] },
  'summer-beacon': single('summer-beacon', 'score', 1800, '为雷雨信标充能'),
  'summer-island': single('summer-island', 'repaired', 10, '救援小岛机器人'),
  'summer-storm-eye': { id: 'summer-storm-eye', stages: [
    { id: 'charge-rods', label: '收集避雷能量', metric: 'score', target: 1200 },
    { id: 'calm-storm', label: '击退风暴霸主', metric: 'bosses', target: 1 },
  ] },
  'autumn-orchard': single('autumn-orchard', 'wave', 4, '守护山谷果园'),
  'autumn-migration': single('autumn-migration', 'score', 2200, '点亮候鸟航标'),
  'autumn-kite-trail': { id: 'autumn-kite-trail', stages: [
    { id: 'find-kites', label: '修复风筝信标', metric: 'repaired', target: 6 },
    { id: 'ride-wind', label: '跟随叶风前进', metric: 'wave', target: 5 },
  ] },
  'winter-lighthouse': single('winter-lighthouse', 'wave', 4, '守护雪夜灯塔'),
  'winter-ice-rescue': single('winter-ice-rescue', 'repaired', 12, '救援冰湖机器人'),
  'winter-aurora': { id: 'winter-aurora', stages: [
    { id: 'aurora-charge', label: '收集极光能量', metric: 'score', target: 1600 },
    { id: 'frost-guardian', label: '唤醒冰原守护者', metric: 'bosses', target: 1 },
  ] },
};

function metricValue(metric: MissionMetric, context: MissionContext): number { return context[metric]; }

export function missionGraphProgress(id: ExpeditionMissionId, context: MissionContext): MissionGraphProgress {
  const graph = MISSION_GRAPHS[id];
  let stage = 0;
  while (stage < graph.stages.length && metricValue(graph.stages[stage]!.metric, context) >= graph.stages[stage]!.target) stage += 1;
  if (stage >= graph.stages.length) {
    const last = graph.stages.at(-1)!;
    return { stage: graph.stages.length - 1, value: last.target, target: last.target, complete: true, label: last.label };
  }
  const current = graph.stages[stage]!;
  return { stage, value: Math.min(metricValue(current.metric, context), current.target), target: current.target, complete: false, label: current.label };
}
