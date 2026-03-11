/** Fetch for Toornament API integration.
 * @const
 */
import fetch from "node-fetch";

import Utils from "../utility/utils.js";

/** Database module.
 * @const
 */
import { db } from "../services/db.js";


import { RowDataPacket } from "mysql2";

import { getSetting } from "./settings.js";

import { ToornamentTokenResponse } from "../types/toornament/ToornamentTokenResponse.js";
import { ToornamentMatch } from "../types/toornament/ToornamentMatch.js";


export default
    async function update_toornament_match(
        toornament_id: number,
        match_id: number | string,
        team1_id: number,
        team2_id: number,
        num_maps: number,
        winner: string | null = null
    ): Promise<void> {


    const clientId: string = getSetting("toornament.clientId");
    const clientSecret: string = getSetting("toornament.clientSecret");
    const apiKey: string = getSetting("toornament.apiKey");

    if (!clientId || !clientSecret || !apiKey) {
        throw new Error("Missing Toornament credentials in settings");
    }

    let sql: string = "SELECT challonge_team_id FROM team WHERE id = ?";
    const team1ToornamentId: RowDataPacket[] = await db.query(sql, [team1_id]);
    const team2ToornamentId: RowDataPacket[] = await db.query(sql, [team2_id]);


    if (!team1ToornamentId[0] || !team2ToornamentId[0]) {
        console.warn(`Toornament: team not found in DB (team1_id=${team1_id}, team2_id=${team2_id})`);
        return;
    }

    const team1Id = team1ToornamentId[0].challonge_team_id;
    const team2Id = team2ToornamentId[0].challonge_team_id;



    const tokenResponse = await fetch("https://api.toornament.com/oauth/v2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'organizer:admin organizer:view organizer:result organizer:participant'
        }),
    });

    const tokenData = await tokenResponse.json() as ToornamentTokenResponse;
    if (!tokenData.access_token) throw new Error("Toornament Auth Failed");

    // Get info of the current open match with the two IDs.
    let toornamentResponse = await fetch(
        "https://api.toornament.com/organizer/v2/matches?tournament_ids=" +
        toornament_id +
        "&participant_ids=" +
        team1Id + "," + team2Id +
        "&statuses=pending,running&sort=structure",
        {
            headers: {
                "Authorization": `Bearer ${tokenData.access_token}`,
                "x-api-key": apiKey,
                "Range": `matches=0-99`
            }
        }
    );

    const matches = await toornamentResponse.json() as ToornamentMatch[];

    const targetMatch = matches.find(match => {
        const participants = match.opponents.map((opp: any) => opp.participant?.id);
        return participants.includes(team1Id) && participants.includes(team2Id);
    });

    if (!targetMatch) {
        console.warn("No active match found with the 2 teams");
        return;
    }


    const sqlMaps: string = "SELECT map_name, team1_score, team2_score, map_number, winner FROM map_stats WHERE match_id = ? ORDER BY map_number ASC";
    const mapsFromDb: any[] = await db.query(sqlMaps, [match_id]);

    const tMatchOpponent1Id = targetMatch.opponents[0].participant?.id;
    const tMatchOpponent2Id = targetMatch.opponents[1].participant?.id;

    for (const map of mapsFromDb) {
        const gameNumber = map.map_number + 1;

        let scoreOpponent1: number;
        let scoreOpponent2: number;
        let resultOpponent1: "win" | "loss" | "draw" | null = null;
        let resultOpponent2: "win" | "loss" | "draw" | null = null;

        if (team1Id === tMatchOpponent1Id) {
            scoreOpponent1 = map.team1_score;
            scoreOpponent2 = map.team2_score;

            if (map.winner) {
                resultOpponent1 = (map.winner === team1_id) ? "win" : "loss";
                resultOpponent2 = (resultOpponent1 === "win") ? "loss" : "win";
            }
        } else {
            scoreOpponent1 = map.team2_score;
            scoreOpponent2 = map.team1_score;

            if (map.winner) {
                resultOpponent1 = (map.winner === team2_id) ? "win" : "loss";
                resultOpponent2 = (resultOpponent1 === "win") ? "loss" : "win";
            }
        }

        const gameUpdateResponse = await fetch(
            `https://api.toornament.com/organizer/v2/matches/${targetMatch.id}/games/${gameNumber}`,
            {
                method: "PATCH",
                headers: {
                    "Authorization": `Bearer ${tokenData.access_token}`,
                    "x-api-key": apiKey,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    opponents: [
                        {
                            score: scoreOpponent1,
                            result: resultOpponent1
                        },
                        {
                            score: scoreOpponent2,
                            result: resultOpponent2
                        }
                    ],
                    properties: {
                        map: map.map_name
                    }
                })
            }
        );

    }

    // --- MISE À JOUR DU SCORE GLOBAL DU MATCH ---

    let matchScore1 = 0;
    let matchScore2 = 0;
    let matchResult1: "win" | "loss" | "draw" | null = null;
    let matchResult2: "win" | "loss" | "draw" | null = null;

    if (num_maps === 1) {
        // Cas BO1 : Le score du match est le score de la map
        if (team1Id === tMatchOpponent1Id) {
            matchScore1 = mapsFromDb[0]?.team1_score || 0;
            matchScore2 = mapsFromDb[0]?.team2_score || 0;
        } else {
            matchScore1 = mapsFromDb[0]?.team2_score || 0;
            matchScore2 = mapsFromDb[0]?.team1_score || 0;
        }
    } else {
        // Cas BOx : On compte les victoires de maps
        mapsFromDb.forEach(m => {
            if (m.winner) {
                if (m.winner === team1_id) {
                    team1Id === tMatchOpponent1Id ? matchScore1++ : matchScore2++;
                } else if (m.winner === team2_id) {
                    team1Id === tMatchOpponent1Id ? matchScore2++ : matchScore1++;
                }
            }
        });
    }

    if (winner) {
        if (winner === "team1") {
            matchResult1 = (team1Id === tMatchOpponent1Id) ? "win" : "loss";
            matchResult2 = (matchResult1 === "win") ? "loss" : "win";
        } else {
            matchResult1 = (team1Id === tMatchOpponent1Id) ? "loss" : "win";
            matchResult2 = (matchResult1 === "win") ? "loss" : "win";
        }
    }

    const matchUpdateResponse = await fetch(
        `https://api.toornament.com/organizer/v2/matches/${targetMatch.id}`,
        {
            method: "PATCH",
            headers: {
                "Authorization": `Bearer ${tokenData.access_token}`,
                "x-api-key": apiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                opponents: [
                    {
                        score: matchScore1,
                        result: matchResult1
                    },
                    {
                        score: matchScore2,
                        result: matchResult2
                    }
                ]
            })
        }
    );

    const sqlMatchInfo: string = "SELECT veto_mappool FROM `match` WHERE id = ?";
    const matchInfo: RowDataPacket[] = await db.query(sqlMatchInfo, [match_id]);

    let mapsPlanned: string[] = [];
    const rawMappool = matchInfo[0]?.veto_mappool?.trim();

    const sqlVetoPicks = "SELECT map FROM veto WHERE match_id = ? AND pick_or_veto = 'pick' ORDER BY id";
    const vetoPicks: RowDataPacket[] = await db.query(sqlVetoPicks, [match_id]);

    if (vetoPicks.length > 0) {
        mapsPlanned = vetoPicks.map(v => v.map);
    } else if (rawMappool) {
        mapsPlanned = rawMappool.split(/\s+/);
    }

    if (mapsPlanned.length > 0) {

        for (let i = 0; i < mapsPlanned.length; i++) {
            const gameNumber = i + 1;
            const mapName = mapsPlanned[i];

            const hasStats = mapsFromDb.some(m => m.map_number === i);

            if (!hasStats) {

                await fetch(
                    `https://api.toornament.com/organizer/v2/matches/${targetMatch.id}/games/${gameNumber}`,
                    {
                        method: "PATCH",
                        headers: {
                            "Authorization": `Bearer ${tokenData.access_token}`,
                            "x-api-key": apiKey,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            properties: {
                                map: mapName
                            }
                        })
                    }
                );
            }
        }
    }

}