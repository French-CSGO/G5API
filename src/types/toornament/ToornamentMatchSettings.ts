export interface ToornamentMatchSettings {
    format: {
        type: "best_of" | "single_set" | string;
        options: {
            nb_match_sets?: number;
            interrupt?: boolean;
            calculation: string;
        };
    };
}