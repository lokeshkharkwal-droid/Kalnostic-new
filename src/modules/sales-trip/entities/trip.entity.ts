import { Trip, TripVisit } from '@prisma/client';

/** Derived visit counts for a trip (single source of truth = TripVisit rows). */
export interface TripVisitCounts {
  visitsPlanned: number;
  visitsCompleted: number;
  visitsPending: number;
  visitsCancelled: number;
}

/** A trip enriched with resolved display fields + derived visit counts (list row). */
export type TripListRow = Trip &
  TripVisitCounts & {
    salespersonName: string | null;
    leadCode: string | null;
  };

/** A trip detail view: the trip + its ordered visits + derived counts + names. */
export type TripDetail = Trip &
  TripVisitCounts & {
    salespersonName: string | null;
    leadCode: string | null;
    visits: TripVisit[];
  };

/** The roadmap view — ordered visits plus the start/end waypoints and totals. */
export interface TripRoadmap extends TripVisitCounts {
  tripId: string;
  tripCode: string;
  salespersonName: string | null;
  startingLocation: string | null;
  startingTime: string | null;
  startingGps: string | null;
  endingLocation: string | null;
  endingTime: string | null;
  endingGps: string | null;
  kmTravelled: number;
  status: Trip['status'];
  visits: TripVisit[];
}
