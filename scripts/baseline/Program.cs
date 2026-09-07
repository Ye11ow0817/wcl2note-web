using System.Globalization;
using System.Text.Json;
using Wcl2Mrt.Core.Enums;
using Wcl2Mrt.Core.Models;
using Wcl2Mrt.Exporting;

// References only the domain and exporter DLLs, never Infrastructure or credentials.
CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("zh-CN");
var formatter = new SimpleTimelineMrtNoteFormatter();
var fight = new FightSummary(1, "测试首领", 1, "史诗", true, DateTimeOffset.UnixEpoch, DateTimeOffset.UnixEpoch.AddHours(2));
var cases = new List<object>();
foreach (var seed in Enumerable.Range(0, 12))
{
    var random = new Random(seed);
    var groups = new List<ActorAbilityCastGroup>();
    for (var i = 0; i < 8; i++)
    {
        var side = i < 4 ? CombatantSide.Enemy : CombatantSide.Friendly;
        var actor = new Combatant(i < 2 ? 10 : 10 + i, new[] { "首领 1", "首领 2", "首领 3", "Zed", "玩家法师 2", "食尸鬼 3", "Yellowdh", "玩家龙" }[i], side, i == 5 ? "Pet" : i < 4 ? "NPC" : "Player", i == 4 ? "Mage" : i == 7 ? "Evoker" : null, i == 5 ? 14 : null);
        var ability = new Ability(i < 3 ? 100 : 200 + i, i < 3 ? "裂解" : new[] { "", "", "", "同步技能", "时间扭曲", "爪击", "虚空射线", "吐息" }[i]);
        var events = Enumerable.Range(0, 3).Select(j => {
            var seconds = j == 0 ? 17 + i * 0.1 : random.Next(20, 5000) + random.NextDouble();
            return new CastEvent(null, DateTimeOffset.UnixEpoch.AddSeconds(seconds), TimeSpan.FromSeconds(seconds), actor.ActorId, actor.Name, side, null, null, ability.AbilityId, ability.Name, SourceInstanceId: i < 4 || i == 5 ? i + 1 : null);
        }).ToArray();
        groups.Add(new ActorAbilityCastGroup(actor, ability, events));
    }
    for (var mask = 0; mask < 16; mask++)
    {
        var options = new TimelineExportOptions((mask & 1) != 0, "测试首领", (mask & 2) != 0, (mask & 4) != 0, (mask & 8) != 0);
        var expected = formatter.FormatTimeline(new TimelineMrtNoteRequest(fight, groups, options)).Content;
        cases.Add(new {
            name = $"seed-{seed}-options-{mask}", title = "测试首领",
            options = new { icon = options.IncludeSpellIcon, friendly = options.IncludeFriendlySource, enemy = options.IncludeEnemySource, simplify = options.SimplifyFriendlySource },
            groups = groups.Select(g => new {
                actor = new { id = g.SourceActor.ActorId, name = g.SourceActor.Name, type = g.SourceActor.Type, subType = g.SourceActor.SubType, petOwner = g.SourceActor.PetOwnerId },
                side = g.SourceActor.Side == CombatantSide.Enemy ? "enemy" : "friendly",
                ability = new { gameID = g.Ability.AbilityId, name = g.Ability.Name },
                events = g.CastEvents.Select(e => new { time = e.RelativeTime.TotalMilliseconds, instance = e.SourceInstanceId })
            }), expected
        });
    }
}
File.WriteAllText(args[0], JsonSerializer.Serialize(cases, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"Generated {cases.Count} differential fixtures from desktop formatter.");
